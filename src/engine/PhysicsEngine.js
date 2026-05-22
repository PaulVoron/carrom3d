/**
 * PhysicsEngine.js
 * Инкапсулирует всё что связано с Rapier3D.
 * Не знает о React, Zustand или DOM.
 * Общается с остальным миром через:
 *   - методы (applyImpulse, addBody, step…)
 *   - коллбэки (onPocketEnter)
 */

import RAPIER from '@dimforge/rapier3d-compat';

// ─── Настройки физики ─────────────────────────────────────────────────────────

export const PHYSICS = {
  damping: 0.2,            // Линейное затухание (сопротивление среды/трение качения)
  friction: 0.045,          // Коэффициент трения фишек о поверхность стола
  restitution: 0.7,        // Упругость фишек (коэффициент отскока при соударении друг с другом)
  boardRestitution: 0.6,   // Упругость бортов стола при отскоке фишек

  coinDia: 0.0318,         // Диаметр фишки (31.8 мм)
  coinHeight: 0.008,       // Высота фишки (8 мм)
  massCoin: 0.0055,        // Масса обычной фишки в кг

  strikerDia: 0.0413,      // Диаметр битка (25.4 мм)
  strikerHeight: 0.008,    // Высота битка (8 мм)
  massStriker: 0.015,      // Масса битка в кг

  maxPullDistance: 0.25,    // Максимальная дистанция оттяжки кия/мыши при прицеливании
  strikerForce: 0.5,       // Множитель силы удара по битку
  solverIterations: 30,    // Количество итераций солвера Rapier3D (выше = точнее контакты)

  fixedTimeStep: 1 / 240,  // Фиксированный шаг симуляции (240Hz) для устранения прохождения сквозь стены
  maxSubSteps: 15,         // Предельное число подшагов физики за один кадр рендеринга
  maxCcdSubsteps: 6,       // Число подшагов CCD (Continuous Collision Detection) для быстролетящих тел

  maxLinearSpeed: 3.0,     // Ограничение максимальной скорости фишек для стабильности физики

  pocketRadius: 0.0265,   // Радиус триггерных зон луз
  pocketOffset: 0.019,   // Смещение центров луз относительно углов игровой поверхности стола
  pocketFallDepth: -0.1,   // Координата Y, ниже которой фишка считается полностью забитой

  pocketDragFactor: 0.85,  // Множитель затухания скорости (трения) при попадании в лузу
  pocketPullForce: 0.3,    // Сила, притягивающая фишку к центру лузы (эффект провала)

  // Цвета фишек
  colorRed: 0xff0000,
  colorBlack: 0x444444,
  colorWhite: 0xbbbbbb,
};

// ─── Маски столкновений ───────────────────────────────────────────────────────

const COL_GROUP_COIN = 0x0001;
const COL_GROUP_FLOOR = 0x0002;
const COL_GROUP_WALLS = 0x0004;

export const MASK_COIN_NORMAL = (COL_GROUP_COIN << 16) | (COL_GROUP_COIN | COL_GROUP_FLOOR | COL_GROUP_WALLS);
export const MASK_COIN_FALLING = (COL_GROUP_COIN << 16) | (COL_GROUP_COIN | COL_GROUP_WALLS);
export const MASK_FLOOR = (COL_GROUP_FLOOR << 16) | COL_GROUP_COIN;
export const MASK_WALLS = (COL_GROUP_WALLS << 16) | COL_GROUP_COIN;

// ─── PhysicsEngine ────────────────────────────────────────────────────────────

export class PhysicsEngine {
  constructor() {
    /** @type {RAPIER.World | null} */
    this.world = null;

    /** @type {Array<{mesh: THREE.Object3D, body: RAPIER.RigidBody}>} */
    this.physicsBodies = [];

    /** Центры луз (THREE.Vector3[]) */
    this.pocketCenters = [];

    // Аккумулятор фиксированного timestep
    this._accumulator = 0;
    this._lastTime = 0;

    /** Коллбэк: вызывается когда объект упал в лузу */
    this.onPocketEnter = null;

    /** Коллбэк: вызывается когда объект вылетел за пределы стола */
    this.onOutOfBounds = null;
    this.boardBounds = null;

    // ── Аудио-коллизии (нативные события Rapier) ─────────────────────────

    /**
     * Коллбэк контактных сил.
     * @type {((entry1: object|null, entry2: object|null, forceMag: number) => void) | null}
     */
    this.onContactForce = null;

    /** @type {RAPIER.EventQueue | null} */
    this.eventQueue = null;

    /**
     * Маппинг collider.handle → wall-sentinel entry.
     * Заполняется в createBoardBodies().
     * @type {Map<number, object>}
     */
    this._wallColliders = new Map();
  }

  // ─── Инициализация ──────────────────────────────────────────────────────────

  async init() {
    await RAPIER.init();

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS.fixedTimeStep;
    this.world.numSolverIterations = PHYSICS.solverIterations;
    this.world.integrationParameters.maxCcdSubsteps = PHYSICS.maxCcdSubsteps;

    // Очередь событий для drainContactForceEvents
    // autoDrain=true: необработанные события автоматически сбрасываются перед следующим step
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  // ─── Создание физических тел ────────────────────────────────────────────────

  /**
   * Создаёт динамическое тело (фишка / монета).
   * @param {number} radius
   * @param {number} halfHeight
   * @param {{x:number, y:number, z:number}} spawnPos
   * @returns {RAPIER.RigidBody}
   */
  createDynamicBody(radius, halfHeight, spawnPos) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
      .setCcdEnabled(true)
      .setLinearDamping(PHYSICS.damping)
      .setAngularDamping(PHYSICS.damping);

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setFriction(PHYSICS.friction)
      .setRestitution(PHYSICS.restitution)
      .setMass(PHYSICS.massCoin)
      .setCollisionGroups(MASK_COIN_NORMAL);

    const collider = this.world.createCollider(colliderDesc, body);
    // Включаем события контактных сил для аудиосистемы
    collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    collider.setContactForceEventThreshold(0.01);
    return body;
  }

  /**
   * Создаёт кинематическое тело (биток в режиме PLACEMENT).
   * @param {number} radius
   * @param {number} halfHeight
   * @param {{x:number, y:number, z:number}} spawnPos
   * @returns {RAPIER.RigidBody}
   */
  createKinematicBody(radius, halfHeight, spawnPos) {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
      .setCcdEnabled(true);

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setFriction(PHYSICS.friction)
      .setRestitution(PHYSICS.restitution)
      .setMass(PHYSICS.massStriker)
      .setCollisionGroups(MASK_COIN_NORMAL);

    const collider = this.world.createCollider(colliderDesc, body);
    // Биток тоже генерирует события контактных сил
    collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    collider.setContactForceEventThreshold(0.01);
    return body;
  }

  /**
   * Создаёт статическое тело доски (пол + борта).
   * @param {object} params — геометрия стола
   */
  createBoardBodies({ minX, maxX, minZ, maxZ, cx, cz, widthX, widthZ }) {
    this.boardBounds = { minX, maxX, minZ, maxZ };
    const po = PHYSICS.pocketOffset;
    // Сохраняем центры луз (THREE.Vector3 создаётся снаружи через коллбэк,
    // здесь храним просто { x, z })
    this.pocketCenters = [
      { x: maxX - po, y: 0, z: maxZ - po },
      { x: maxX - po, y: 0, z: minZ + po },
      { x: minX + po, y: 0, z: maxZ - po },
      { x: minX + po, y: 0, z: minZ + po },
    ];

    const boardTopY = 0.001;
    const floorHalfH = 0.05;
    const floorCenterY = boardTopY - floorHalfH;

    const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorCenterY, 0);
    const floorBody = this.world.createRigidBody(floorBodyDesc);

    // Пол
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(widthX / 2, floorHalfH, widthZ / 2)
        .setTranslation(cx, 0, cz)
        .setFriction(PHYSICS.friction)
        .setRestitution(0.1)
        .setCollisionGroups(MASK_FLOOR),
      floorBody
    );

    // Борта
    const wt = 0.1;
    const wh = 0.10;
    const wy = floorHalfH - 0.05;

    const walls = [
      RAPIER.ColliderDesc.cuboid(widthX / 2 + wt, wh, wt / 2).setTranslation(cx, wy, minZ - wt / 2),
      RAPIER.ColliderDesc.cuboid(widthX / 2 + wt, wh, wt / 2).setTranslation(cx, wy, maxZ + wt / 2),
      RAPIER.ColliderDesc.cuboid(wt / 2, wh, widthZ / 2 + wt).setTranslation(minX - wt / 2, wy, cz),
      RAPIER.ColliderDesc.cuboid(wt / 2, wh, widthZ / 2 + wt).setTranslation(maxX + wt / 2, wy, cz),
    ];

    // Сентинел для определения типа 'wall' в drainContactEvents
    const wallSentinel = { mesh: { userData: { type: 'wall' } } };
    walls.forEach(w => {
      const wc = this.world.createCollider(
        w.setFriction(0.1).setRestitution(PHYSICS.boardRestitution).setCollisionGroups(MASK_WALLS),
        floorBody
      );
      wc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      wc.setContactForceEventThreshold(0.01);
      this._wallColliders.set(wc.handle, wallSentinel);
    });

    // Невидимая крышка
    const roofHeight = 0.34;
    const roofBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, roofHeight, 0)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(2.0, 0.01, 2.0)
        .setFriction(0.0)
        .setRestitution(0.2)
        .setCollisionGroups(MASK_WALLS),
      roofBody
    );
  }

  // ─── Шаг физики ─────────────────────────────────────────────────────────────

  /**
   * Выполняет физический шаг с фиксированным timestep.
   * Вызывается из RAF-цикла для всех фаз кроме PLACEMENT.
   * @returns {number} Количество выполненных шагов
   */
  tick() {
    const now = performance.now() / 1000;
    if (this._lastTime === 0) this._lastTime = now;

    let frameDelta = now - this._lastTime;
    this._lastTime = now;

    // Защита от spiral of death
    const maxDelta = PHYSICS.fixedTimeStep * PHYSICS.maxSubSteps;
    if (frameDelta > maxDelta) frameDelta = maxDelta;

    this._accumulator += frameDelta;

    let steps = 0;
    while (this._accumulator >= PHYSICS.fixedTimeStep && steps < PHYSICS.maxSubSteps) {
      this._clampAllSpeeds();
      this._updateDynamicMaterials();
      // Передаём eventQueue: события генерируются внутри step
      this.world.step(this.eventQueue);
      // Сразу обрабатываем: с autoDrain=true события сбрасываются перед следующим step
      this._drainContactEvents();
      steps++;
      this._accumulator -= PHYSICS.fixedTimeStep;
    }

    return steps;
  }

  /** Сбросить аккумулятор (после паузы, смены фазы) */
  resetAccumulator() {
    this._lastTime = 0;
    this._accumulator = 0;
  }

  // ─── Скорости ────────────────────────────────────────────────────────────────

  _clampAllSpeeds() {
    const maxSpeed = PHYSICS.maxLinearSpeed;
    const maxSq = maxSpeed * maxSpeed;

    for (const entry of this.physicsBodies) {
      const body = entry.body;
      if (!body.isEnabled() || body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;
      const vel = body.linvel();
      const sq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
      if (sq > maxSq) {
        const s = maxSpeed / Math.sqrt(sq);
        body.setLinvel({ x: vel.x * s, y: vel.y * s, z: vel.z * s }, true);
      }
    }
  }

  _updateDynamicMaterials() {
    for (const entry of this.physicsBodies) {
      const body = entry.body;
      if (!body.isEnabled() || body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;

      const rot = body.rotation();
      // Вычисляем компоненту Y локального вектора "Вверх".
      // Для кватерниона q, Y-компонента повернутого вектора (0, 1, 0) это: 1 - 2 * (q.x^2 + q.z^2)
      const upY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
      
      const collider = body.collider(0);
      if (collider) {
        // Если вектор сильно отклонен от вертикали (|upY| < 0.8 означает наклон больше ~36 градусов)
        if (Math.abs(upY) < 0.8) {
          collider.setRestitution(0.1); // Снижаем упругость (прыгучесть) на ребре
        } else {
          collider.setRestitution(PHYSICS.restitution); // Возвращаем нормальную упругость
        }
      }
    }
  }

  /**
   * Дрейнит контактные силы из EventQueue и вызывает onContactForce.
   * Необходимо вызывать CPAЗУ после world.step(), так как
   * с autoDrain=true события сбрасываются перед следующим step.
   * Пол (флор) и крыша не зарегистрированы в handleMap → null-проверка в onContactForce фильтрует их.
   */
  _drainContactEvents() {
    if (!this.onContactForce || !this.eventQueue) return;

    // Строим маппинг collider.handle → entry (только активные тела)
    const handleMap = new Map();
    for (const entry of this.physicsBodies) {
      if (!entry.body.isEnabled()) continue;
      const col = entry.body.collider(0);
      if (col) handleMap.set(col.handle, entry);
    }
    // Добавляем борта (сентинел с type:'wall')
    for (const [handle, wallEntry] of this._wallColliders) {
      handleMap.set(handle, wallEntry);
    }

    this.eventQueue.drainContactForceEvents((event) => {
      const entry1 = handleMap.get(event.collider1()) ?? null;
      const entry2 = handleMap.get(event.collider2()) ?? null;
      const force  = event.totalForceMagnitude();
      this.onContactForce(entry1, entry2, force);
    });
  }

  // ─── Лузы ────────────────────────────────────────────────────────────────────

  /**
   * Проверяет все тела на попадание в лузу.
   * Вызывать после каждого physics step.
   * При попадании вызывает this.onPocketEnter(entry).
   */
  checkPockets() {
    for (const entry of this.physicsBodies) {
      const { mesh, body } = entry;
      if (!body.isEnabled()) continue;

      const pos = body.translation();

      // ── Проверка на вылет за борт (вниз или зависание на бортике) ───────────
      const isOutside = this.boardBounds && (
        pos.x < this.boardBounds.minX ||
        pos.x > this.boardBounds.maxX ||
        pos.z < this.boardBounds.minZ ||
        pos.z > this.boardBounds.maxZ
      );

      // ── Финальное удаление (падение под стол) ──────────────────────────
      if (pos.y < PHYSICS.pocketFallDepth) {
        if (mesh.userData.isFalling) {
          if (this.onPocketEnter) this.onPocketEnter(entry);
        } else {
          if (this.onOutOfBounds) this.onOutOfBounds(entry);
        }
        continue;
      }

      // Если фишка за пределами поля и практически остановилась на бортике
      if (isOutside && !mesh.userData.isFalling) {
        const vel = body.linvel();
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
        if (speed < 0.01) { // Полностью остановилась на бортике
          console.log(`⚠️ Фишка ${mesh.userData.type} застряла на бортике.`);
          if (this.onOutOfBounds) this.onOutOfBounds(entry);
          continue;
        }
      }

      // ── Засасывание в лузу ────────────────────────────────────────────
      let nearestCenter = null;
      let nearestDist = Infinity;

      for (const center of this.pocketCenters) {
        const dx = pos.x - center.x;
        const dz = pos.z - center.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < PHYSICS.pocketRadius * 0.8 && dist < nearestDist) {
          nearestCenter = center;
          nearestDist = dist;
        }
      }

      const collider = body.collider(0);
      if (!collider) continue;

      if (nearestCenter) {
        if (!mesh.userData.isFalling) {
          collider.setCollisionGroups(MASK_COIN_FALLING);
          body.wakeUp();
          mesh.userData.isFalling = true;
        }

        // Горизонтальное торможение
        const vel = body.linvel();
        body.setLinvel({ x: vel.x * PHYSICS.pocketDragFactor, y: vel.y, z: vel.z * PHYSICS.pocketDragFactor }, true);

        // Притяжение к центру
        if (nearestDist > 0.001) {
          const pullStr = PHYSICS.pocketPullForce * PHYSICS.fixedTimeStep;
          body.applyImpulse({
            x: ((nearestCenter.x - pos.x) / nearestDist) * pullStr,
            y: 0,
            z: ((nearestCenter.z - pos.z) / nearestDist) * pullStr,
          }, true);
        }
      } else {
        if (mesh.userData.isFalling) {
          collider.setCollisionGroups(MASK_COIN_NORMAL);
          mesh.userData.isFalling = false;
        }
      }
    }
  }

  // ─── Импульс ─────────────────────────────────────────────────────────────────

  /**
   * Применить импульс к битку.
   * @param {RAPIER.RigidBody} body
   * @param {{x:number, y:number, z:number}} impulse
   */
  applyImpulse(body, impulse) {
    body.applyImpulse({ x: impulse.x, y: 0, z: impulse.z }, true);
  }

  /** Разбудить все тела */
  wakeAll() {
    for (const entry of this.physicsBodies) {
      if (entry.body.isEnabled()) entry.body.wakeUp();
    }
  }

  // ─── Утилиты ─────────────────────────────────────────────────────────────────

  /**
   * Найти свободную позицию для возврата фишки.
   * @param {boolean} isQueen 
   * @param {number} coinRadius 
   * @param {Array<{x: number, z: number, r: number}>} additionalObstacles
   * @returns {{x: number, z: number}}
   */
  getFreePosition(isQueen, coinRadius, additionalObstacles = []) {
    const obstacles = [...additionalObstacles];
    for (const entry of this.physicsBodies) {
      if (entry.body.isEnabled() || entry.mesh.visible) {
        const type = entry.mesh.userData.type;
        if (['striker', 'queen', 'white', 'black'].includes(type)) {
          const r = type === 'striker' ? PHYSICS.strikerDia / 2 : PHYSICS.coinDia / 2;
          const pos = entry.mesh.position; 
          obstacles.push({ x: pos.x, z: pos.z, r });
        }
      }
    }

    const checkOverlap = (x, z) => {
      for (const obs of obstacles) {
        const dx = x - obs.x;
        const dz = z - obs.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < coinRadius + obs.r + 0.002) { 
          return true;
        }
      }
      return false;
    };

    if (isQueen) {
      if (!checkOverlap(0, 0)) return { x: 0, z: 0 };
      let step = 0.005;
      for (let r = step; r < 0.3; r += step) {
        const numPoints = Math.floor((2 * Math.PI * r) / step);
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2;
          const x = Math.cos(angle) * r;
          const z = Math.sin(angle) * r;
          if (!checkOverlap(x, z)) return { x, z };
        }
      }
      return { x: 0, z: 0 };
    } else {
      const maxR = 0.085 - coinRadius;
      for (let i = 0; i < 1000; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * maxR; 
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (!checkOverlap(x, z)) return { x, z };
      }
      return { x: 0, z: 0 };
    }
  }

  /**
   * Проверяет, остановились ли все динамические тела.
   * @returns {boolean}
   */
  areAllSleeping() {
    for (const entry of this.physicsBodies) {
      if (!entry.body.isEnabled()) continue;
      if (entry.body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;

      const v = entry.body.linvel();
      const av = entry.body.angvel();
      const sq = v.x * v.x + v.y * v.y + v.z * v.z;
      const asq = av.x * av.x + av.y * av.y + av.z * av.z;

      if (sq > 0.0001 || asq > 0.0001) return false;
    }
    return true;
  }

  /**
   * Прогреть физику (усадка фишек на стол после создания).
   * @param {number} steps
   */
  warmup(steps = 240) {
    for (let i = 0; i < steps; i++) {
      this.world.step();
    }
  }

  /** Перевести биток из kinematic в dynamic */
  makeStrikerDynamic(strikerEntry, position) {
    const body = strikerEntry.body;
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setTranslation(position, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.wakeUp();
  }

  /** Перевести биток обратно в kinematic (начало хода) */
  makeStrikerKinematic(strikerEntry, position) {
    const body = strikerEntry.body;
    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setTranslation(position, true);
    body.setNextKinematicTranslation(position, true);
  }

  /** Восстановить биток после лузы */
  restoreStriker(strikerEntry, position) {
    const body = strikerEntry.body;
    body.setEnabled(true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.sleep();

    const collider = body.collider(0);
    if (collider) collider.setCollisionGroups(MASK_COIN_NORMAL);

    this.makeStrikerKinematic(strikerEntry, position);
  }

  // ─── Снапшоты (для мультиплеера) ─────────────────────────────────────────────

  getSnapshot() {
    const snapshot = [];
    for (let i = 0; i < this.physicsBodies.length; i++) {
      const entry = this.physicsBodies[i];
      const body = entry.body;
      snapshot.push({
        isEnabled: body.isEnabled(),
        translation: body.translation(),
        rotation: body.rotation(),
        linvel: body.linvel(),
        angvel: body.angvel(),
      });
    }
    return snapshot;
  }

  applySnapshot(snapshot) {
    for (let i = 0; i < this.physicsBodies.length; i++) {
      const entry = this.physicsBodies[i];
      const snap = snapshot[i];
      if (!snap) continue;
      
      const body = entry.body;
      if (snap.isEnabled) {
        body.setEnabled(true);
        body.setTranslation(snap.translation, true);
        body.setRotation(snap.rotation, true);
        body.setLinvel(snap.linvel, true);
        body.setAngvel(snap.angvel, true);
        body.sleep();
        
        entry.mesh.position.copy(snap.translation);
        entry.mesh.quaternion.copy(snap.rotation);
        entry.mesh.visible = true;
        if (entry.mesh.userData.type === 'striker') {
           entry.mesh.userData.pocketed = false;
        }
      } else {
        body.setEnabled(false);
        entry.mesh.visible = false;
        if (entry.mesh.userData.type === 'striker') {
           entry.mesh.userData.pocketed = true;
        }
      }
    }
  }

  dispose() {
    this.physicsBodies = [];
    this.pocketCenters = [];
    this._wallColliders.clear();
    if (this.eventQueue) {
      this.eventQueue.free?.();
      this.eventQueue = null;
    }
    if (this.world) {
      this.world.free?.();
      this.world = null;
    }
  }
}
