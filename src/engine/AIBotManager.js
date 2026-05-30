/**
 * AIBotManager.js
 * ИИ-бот для Carrom 3D — уровень сложности «Мастер».
 *
 * Ключевые алгоритмы:
 *
 * ── Ghost Ball (Cut Shot) ──────────────────────────────────────────────
 * Для каждой пары (фишка, луза) вычисляется идеальная точка контакта
 * P_contact — позиция центра битка в момент удара, при котором фишка
 * полетит строго в лузу.
 *
 *   V_pocket  = normalize(Pocket_Pos − Coin_Pos)   // направление к лузе
 *   P_contact = Coin_Pos − V_pocket × (R_striker + R_coin)
 *
 * P_contact лежит на линии «фишка → луза», позади фишки на расстоянии
 * суммы радиусов. Биток, ударивший фишку строго из P_contact, передаёт
 * импульс вдоль V_pocket → фишка летит в лузу.
 *
 * ── Target Scoring ─────────────────────────────────────────────────────
 * Для каждого валидного удара (target, pocket, strikerX) рассчитывается
 * «сложность» (difficulty score):
 *
 *   totalDist = dist(Striker, P_contact) + dist(Coin, Pocket)
 *   cutAngle  = угол между dir(Striker → P_contact) и dir(Coin → Pocket)
 *   score     = totalDist + cutAngle × 2.0 − queenBonus
 *
 * Удары с cutAngle > 70° отбрасываются. Из оставшихся выбирается
 * лучший (минимальный score).
 */

import * as THREE from 'three';
import gsap from 'gsap';
import { useGameStore } from '../store/useGameStore.js';
import { PLAYER_2_LINE_Z, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X } from './InputController.js';
import { PHYSICS } from './PhysicsEngine.js';
import RAPIER from '@dimforge/rapier3d-compat';

// ── Константы бота ──────────────────────────────────────────────────────────

/** Максимальный угол резки (рад). Удары с бо́льшим углом игнорируются. */
const MAX_CUT_ANGLE = 70 * (Math.PI / 180);

/** Шаг сканирования X вокруг идеальной позиции (м) */
const X_SCAN_STEP = 0.005;

/** Окрестность идеального X для сканирования (м) */
const X_SCAN_RADIUS = 0.03;

/** Минимальный зазор при проверке перекрытия (м) */
const PLACEMENT_GAP = 0.01;

/** Вес угла резки в скоринге */
const CUT_ANGLE_WEIGHT = 2.5;

/** Бонус за Королеву (вычитается из score → приоритет) */
const QUEEN_BONUS = 1.0;

export class AIBotManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.isThinking = false;
    this.unsub = useGameStore.subscribe(state => state, (state) => this.onStateChange(state));
  }

  onStateChange(state) {
    if (state.gameMode !== 'pve') return;
    if (state.currentPlayer !== 2) return;
    if (state.gamePhase === 'PLACEMENT' && !this.isThinking && state.isReady) {
      this.isThinking = true;
      // Задержка для «человечного» ощущения
      setTimeout(() => this.playTurn(), 1000);
    } else if (state.gamePhase !== 'PLACEMENT' && state.gamePhase !== 'AIMING') {
      this.isThinking = false;
    }
  }

  // ─── Главный метод хода ──────────────────────────────────────────────────────

  playTurn() {
    const shotInfo = this._buildBestShot();

    if (!shotInfo) {
      // Fallback: случайный удар, если ни одного чистого пути не найдено
      this.executeShot(0, new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5));
      return;
    }

    // Clamp импульс к максимальной силе
    if (shotInfo.impulse.length() > PHYSICS.maxPullDistance) {
      shotInfo.impulse.setLength(PHYSICS.maxPullDistance);
    }

    this.executeShot(shotInfo.strikerX, shotInfo.impulse);
  }

  // ─── Построение лучшего удара ────────────────────────────────────────────────

  /**
   * Собирает все валидные удары, оценивает их и возвращает лучший.
   * @returns {{ strikerX: number, impulse: THREE.Vector3 } | null}
   */
  _buildBestShot() {
    const state = useGameStore.getState();
    const myColor = state.playerColors.player2;
    const bodies = this.orchestrator.physics.physicsBodies;
    const pockets = this.orchestrator.physics.pocketCenters;

    // ── 1. Определяем разрешённые цели ────────────────────────────────────────
    const validTargets = this._getValidTargets(state, myColor, bodies);
    if (validTargets.length === 0) return null;

    // ── 2. Собираем и оцениваем все возможные удары ────────────────────────────
    const R_striker = PHYSICS.strikerDia / 2;
    const R_coin = PHYSICS.coinDia / 2;
    const contactDist = R_striker + R_coin;

    let bestShot = null;
    let bestScore = Infinity;

    for (const target of validTargets) {
      const coinPos = target.entry.body.translation();
      const coinType = target.entry.mesh.userData.type;

      for (const pocket of pockets) {
        // ── Ghost Ball: вычисляем точку контакта P_contact ────────────────
        const toPocketX = pocket.x - coinPos.x;
        const toPocketZ = pocket.z - coinPos.z;
        const distToPocket = Math.sqrt(toPocketX * toPocketX + toPocketZ * toPocketZ);
        if (distToPocket < 0.001) continue;

        // Нормализованное направление фишка → луза
        const dirPocketX = toPocketX / distToPocket;
        const dirPocketZ = toPocketZ / distToPocket;

        // P_contact = Coin_Pos − dir_pocket × (R_striker + R_coin)
        const contactX = coinPos.x - dirPocketX * contactDist;
        const contactZ = coinPos.z - dirPocketZ * contactDist;

        // ── Луч 1: фишка → луза (свободен ли путь?) ──────────────────────
        if (!this._isSegmentClear(coinPos.x, coinPos.z, pocket.x, pocket.z, target.entry.body)) {
          continue;
        }

        // ── Вычисляем идеальный X на линии бота ──────────────────────────
        // Прямая P_contact → strikerLine: находим X при Z = PLAYER_2_LINE_Z
        const dz = PLAYER_2_LINE_Z - contactZ;
        if (Math.abs(dz) < 0.001) continue; // P_contact слишком близко к линии

        // Направление от P_contact к битку должно идти «вперёд» (к линии бота)
        // Для player 2 линия при Z = -0.25, фишки обычно при Z > -0.25
        // Значит dz < 0 (идём назад) — допустимо, бот стреляет вперёд (+Z)
        // Нужно чтобы от strikerPos до P_contact было Z > 0 (вперёд для player2)
        if (contactZ <= PLAYER_2_LINE_Z) continue; // Цель позади линии бота

        // Идеальный X — проекция линии (contactX, contactZ) → по направлению к линии
        // Простая линейная интерполяция: мы бьём прямо из (idealX, PLAYER_2_LINE_Z) в (contactX, contactZ)
        // Идеальная прямая — прямо к P_contact, поэтому idealX = contactX
        const idealX = contactX;

        // ── Сканируем окрестность idealX на валидные позиции ──────────────
        const scanMin = Math.max(PLAYER_LINE_MIN_X, idealX - X_SCAN_RADIUS);
        const scanMax = Math.min(PLAYER_LINE_MAX_X, idealX + X_SCAN_RADIUS);

        for (let x = scanMin; x <= scanMax; x += X_SCAN_STEP) {
          // ── Проверка валидности расстановки ─────────────────────────────
          if (!this._isPlacementValid(x, bodies)) continue;

          // ── Направление удара: striker → P_contact ─────────────────────
          const toContactX = contactX - x;
          const toContactZ = contactZ - PLAYER_2_LINE_Z;
          const distToContact = Math.sqrt(toContactX * toContactX + toContactZ * toContactZ);
          if (distToContact < 0.001) continue;

          const dirHitX = toContactX / distToContact;
          const dirHitZ = toContactZ / distToContact;

          // Бот должен стрелять «вперёд» (положительный Z для player 2)
          if (dirHitZ < 0.05) continue;

          // ── Угол резки (cut angle) ─────────────────────────────────────
          // Угол между направлением удара и направлением фишка→луза
          const dot = dirHitX * dirPocketX + dirHitZ * dirPocketZ;
          const cutAngle = Math.acos(Math.min(1.0, Math.max(-1.0, dot)));

          if (cutAngle > MAX_CUT_ANGLE) continue;

          // ── Луч 2: striker → P_contact (свободна ли линия удара?) ──────
          const strikerBody = this.orchestrator.rules.strikerEntry.body;
          if (!this._isSegmentClear(x, PLAYER_2_LINE_Z, contactX, contactZ, strikerBody, target.entry.body)) {
            continue;
          }

          // ── Скоринг ────────────────────────────────────────────────────
          const totalDist = distToContact + distToPocket;
          let score = totalDist + cutAngle * CUT_ANGLE_WEIGHT;

          // Бонус за Королеву
          if (target.isQueen) {
            score -= QUEEN_BONUS;
          }

          if (score < bestScore) {
            bestScore = score;

            // ── Динамическая сила удара ──────────────────────────────────
            let force;
            if (this.orchestrator.rules._isFirstStrike) {
              force = PHYSICS.maxPullDistance; // Полная максимальная сила на разбой пирамиды
            } else {
              // Настройка силы для ВСЕХ последующих ударов:
              // Формула: totalDist * МНОЖИТЕЛЬ + БАЗА.
              // Сейчас: multiplier = 0.06 (было 0.12), base = 0.015 (было 0.03).
              // Измените эти два значения ниже, чтобы отрегулировать силу ударов бота!
              const forceMultiplier = 0.06; 
              const forceBase = 0.015;

              force = Math.min(
                Math.max(totalDist * forceMultiplier + forceBase, 0.03),
                PHYSICS.maxPullDistance
              );
            }

            bestShot = {
              strikerX: x,
              impulse: new THREE.Vector3(dirHitX, 0, dirHitZ).multiplyScalar(force),
            };
          }
        }
      }
    }

    // ── Fallback: если нет чистого пути, бьём в ближайшую фишку ──────────────
    if (!bestShot) {
      bestShot = this._buildFallbackShot(validTargets);
    }

    return bestShot;
  }

  // ─── Определение разрешённых целей ───────────────────────────────────────────

  /**
   * Возвращает массив объектов { entry, isQueen } с учётом правил Королевы.
   */
  _getValidTargets(state, myColor, bodies) {
    const queenState = state.queenState;
    const score = state.score;
    const targets = [];

    // Если Королева забита и требует покрытия (Cover) →
    // бот ОБЯЗАН бить только фишки своего цвета
    if (queenState === 'pocketed_uncovered' && myColor) {
      for (const entry of bodies) {
        if (!entry.body.isEnabled()) continue;
        const type = entry.mesh.userData.type;
        if (type === myColor) {
          targets.push({ entry, isQueen: false });
        }
      }
      return targets;
    }

    // Обычный режим: собираем все допустимые цели
    for (const entry of bodies) {
      if (!entry.body.isEnabled()) continue;
      const type = entry.mesh.userData.type;
      if (type === 'striker') continue;

      if (!myColor) {
        // Цвет ещё не назначен → можно бить любую фишку
        if (type === 'white' || type === 'black' || type === 'queen') {
          targets.push({ entry, isQueen: type === 'queen' });
        }
        continue;
      }

      // Свои фишки — всегда валидны
      if (type === myColor) {
        targets.push({ entry, isQueen: false });
        continue;
      }

      // Королева на столе — проверяем легальность
      if (type === 'queen' && queenState === 'on_board') {
        const myScore = score[myColor] || 0;

        // Нельзя бить Королеву, если нет ни одной забитой фишки своего цвета
        if (myScore === 0) continue;

        // Нельзя бить Королеву, если она будет «последней»
        // (все 9 своих забиты — это невозможно, но 8 забито и Королева не покрыта)
        if (myScore >= 8) continue;

        // Легально → добавляем с максимальным приоритетом (isQueen = true)
        targets.push({ entry, isQueen: true });
      }
    }

    return targets;
  }

  // ─── Fallback удар ───────────────────────────────────────────────────────────

  /**
   * Fallback: бьём прямо в ближайшую фишку из ближайшей валидной X-позиции.
   */
  _buildFallbackShot(validTargets) {
    if (validTargets.length === 0) return null;

    const bodies = this.orchestrator.physics.physicsBodies;
    const fallbackTarget = validTargets[0];
    const pos = fallbackTarget.entry.body.translation();

    // Пытаемся найти валидную X позицию как можно ближе к фишке
    let x = THREE.MathUtils.clamp(pos.x, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X);
    x = this._findNearestValidX(x, bodies);

    const dirX = pos.x - x;
    const dirZ = pos.z - PLAYER_2_LINE_Z;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);

    // Fallback сила удара (было 0.08, уменьшаем до 0.04)
    let force = 0.08;
    if (this.orchestrator.rules._isFirstStrike) {
      force = PHYSICS.maxPullDistance;
    }

    return {
      strikerX: x,
      impulse: new THREE.Vector3(dirX / len, 0, dirZ / len).multiplyScalar(force),
    };
  }

  // ─── Валидация расстановки ───────────────────────────────────────────────────

  /**
   * Проверяет, можно ли поставить биток на позицию (x, PLAYER_2_LINE_Z).
   * Дистанция до всех фишек должна быть >= R_striker + R_coin + PLACEMENT_GAP.
   * Также проверяем через InputController.validatePlacement (базовые круги).
   */
  _isPlacementValid(x, bodies) {
    const R_striker = PHYSICS.strikerDia / 2;
    const R_coin = PHYSICS.coinDia / 2;
    const minDist = R_striker + R_coin + PLACEMENT_GAP;
    const minDistSq = minDist * minDist;
    const z = PLAYER_2_LINE_Z;
    const strikerEntry = this.orchestrator.rules.strikerEntry;

    // Проверка перекрытия со всеми фишками
    for (const entry of bodies) {
      if (entry === strikerEntry || !entry.body.isEnabled()) continue;
      const p = entry.body.translation();
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < minDistSq) return false;
    }

    // Проверка через InputController (базовые круги на концах линии)
    return this.orchestrator.input.validatePlacement(
      x, z, bodies, strikerEntry, R_striker, R_coin
    );
  }

  /**
   * Находит ближайшую валидную X-позицию к desiredX.
   * Сканирует в обе стороны с шагом X_SCAN_STEP.
   */
  _findNearestValidX(desiredX, bodies) {
    if (this._isPlacementValid(desiredX, bodies)) return desiredX;

    for (let offset = X_SCAN_STEP; offset <= 0.3; offset += X_SCAN_STEP) {
      const left = desiredX - offset;
      const right = desiredX + offset;

      if (left >= PLAYER_LINE_MIN_X && this._isPlacementValid(left, bodies)) return left;
      if (right <= PLAYER_LINE_MAX_X && this._isPlacementValid(right, bodies)) return right;
    }

    return 0; // Крайний fallback — центр
  }

  // ─── Raycasting: проверка чистоты сегмента ──────────────────────────────────

  /**
   * Проверяет, свободен ли путь от (startX, startZ) до (endX, endZ)
   * в плоскости XZ. Использует Rapier world.castRay.
   *
   * @param {number} startX
   * @param {number} startZ
   * @param {number} endX
   * @param {number} endZ
   * @param  {...RAPIER.RigidBody} ignoreBodies — тела, которые нужно игнорировать
   * @returns {boolean} true если путь свободен
   */
  _isSegmentClear(startX, startZ, endX, endZ, ...ignoreBodies) {
    const world = this.orchestrator.physics.world;
    if (!world) return true;

    const dx = endX - startX;
    const dz = endZ - startZ;
    const maxToi = Math.sqrt(dx * dx + dz * dz);
    if (maxToi < 0.001) return true;

    // Нормализованное направление
    const invLen = 1 / maxToi;
    const ndx = dx * invLen;
    const ndz = dz * invLen;

    // Набор handle'ов тел для игнорирования
    const ignoreHandles = new Set();
    for (const body of ignoreBodies) {
      if (body) ignoreHandles.add(body.handle);
    }

    // Стартуем луч чуть впереди начала (0.001) чтобы не поймать себя
    const origin = new RAPIER.Vector3(startX + ndx * 0.002, 0.005, startZ + ndz * 0.002);
    const direction = new RAPIER.Vector3(ndx, 0, ndz);
    const ray = new RAPIER.Ray(origin, direction);

    const hit = world.castRay(ray, maxToi, true, 0x00010001);
    if (!hit) return true; // Ничего не задели → путь чист

    // Проверяем, принадлежит ли задетый коллайдер одному из игнорируемых тел
    const hitParent = hit.collider.parent();
    if (hitParent && ignoreHandles.has(hitParent.handle)) {
      // Задели игнорируемое тело — запускаем второй луч из-за него
      const passPoint = hit.toi + 0.005;
      if (passPoint >= maxToi) return true;

      const origin2 = new RAPIER.Vector3(
        startX + ndx * (0.002 + passPoint),
        0.005,
        startZ + ndz * (0.002 + passPoint)
      );
      const ray2 = new RAPIER.Ray(origin2, direction);
      const remainingDist = maxToi - passPoint;

      const hit2 = world.castRay(ray2, remainingDist, true, 0x00010001);
      if (!hit2) return true;

      const hit2Parent = hit2.collider.parent();
      if (hit2Parent && ignoreHandles.has(hit2Parent.handle)) {
        // Второе попадание тоже в игнорируемое тело → считаем путь чистым
        return true;
      }
      return false; // Путь заблокирован
    }

    return false; // Путь заблокирован не-игнорируемым телом
  }

  // ─── Выполнение удара с анимацией ────────────────────────────────────────────

  executeShot(x, impulse) {
    const startX = this.orchestrator.rules.strikerEntry.mesh.position.x;
    const durSlide = Math.abs(x - startX) * 2 + 0.5;

    const dragObj = { val: startX };

    gsap.to(dragObj, {
      val: x,
      duration: durSlide,
      ease: 'power1.inOut',
      onUpdate: () => {
        this.orchestrator.rules.onStrikerDrag(dragObj.val, 2);
      },
      onComplete: () => {
        setTimeout(() => {
          this.orchestrator.rules.confirmPlacement(true);

          const currentImpulse = this.orchestrator.input.currentImpulse;

          gsap.to(currentImpulse, {
            x: impulse.x,
            y: impulse.y,
            z: impulse.z,
            duration: 1.0,
            ease: 'power2.out',
            onComplete: () => {
              setTimeout(() => {
                this.orchestrator.rules.shoot(currentImpulse, true);
                currentImpulse.set(0, 0, 0);
              }, 200);
            },
          });
        }, 500);
      },
    });
  }

  dispose() {
    this.unsub();
  }
}
