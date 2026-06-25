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

/** Штраф за удары назад (в сторону своей линии) */
const BACKWARD_SHOT_PENALTY = 2.0;

/** Штраф за удары от борта (bank shots) */
const BANK_SHOT_PENALTY = 1.5;

export class AIBotManager {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.isThinking = false;
    this.unsub = useGameStore.subscribe(state => state, (state) => this.onStateChange(state));
  }

  onStateChange(state) {
    if (state.gameMode !== 'pve') return;
    if (state.winner !== null) {
      this.isThinking = false;
      return;
    }
    if (state.currentPlayer !== 2) return;
    if (state.gamePhase === 'PLACEMENT' && !this.isThinking && state.isReady) {
      this.isThinking = true;
      
      // Если бот ходит первым, то он не вращает пирамиду, 
      // а просто сразу применяет её текущее (дефолтное) состояние
      if (!state.isPyramidLocked) {
        this.orchestrator.applyPyramidRotation();
      }

      // Задержка для «человечного» ощущения
      setTimeout(() => this.playTurn(), 1000);
    } else if (state.gamePhase !== 'PLACEMENT' && state.gamePhase !== 'AIMING') {
      this.isThinking = false;
    }
  }

  // ─── Главный метод хода ──────────────────────────────────────────────────────

  playTurn() {
    if (useGameStore.getState().winner !== null) return;
    
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
    const difficulty = state.botDifficulty || 3; // 1: Easy, 2: Medium, 3: Master
    const myColor = state.playerColors.player2;
    const bodies = this.orchestrator.physics.physicsBodies;
    const pockets = this.orchestrator.physics.pocketCenters;

    // Устанавливаем параметры в зависимости от сложности
    const diffMaxCutAngle = difficulty === 1 ? 30 * (Math.PI / 180) :
                            difficulty === 2 ? 50 * (Math.PI / 180) :
                            MAX_CUT_ANGLE;

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

      for (const pocket of pockets) {
        // ── Обычный прямой удар (Ghost Ball) ──────────────────────────────
        const shotInfo = this._evaluateDirectShot(
          target, coinPos, pocket, contactDist, difficulty, diffMaxCutAngle, bodies
        );

        if (shotInfo && shotInfo.score < bestScore) {
          bestScore = shotInfo.score;
          bestShot = shotInfo.shot;
        }

        // ── Удар через борт (Bank Shot) ───────────────────────────────────
        const bankShotInfo = this._evaluateBankShot(
          target, coinPos, pocket, contactDist, difficulty, diffMaxCutAngle, bodies
        );

        if (bankShotInfo && bankShotInfo.score < bestScore) {
          bestScore = bankShotInfo.score;
          bestShot = bankShotInfo.shot;
        }
      }
    }

    // Применяем погрешность в прицеливании (шум угла) для низких сложностей
    if (bestShot && difficulty < 3) {
      const noiseRange = difficulty === 1 ? 0.05 : 0.015; // Радианы (~2.8° и ~0.8°)
      const noiseAngle = (Math.random() - 0.5) * 2 * noiseRange;
      const currentAngle = Math.atan2(bestShot.impulse.z, bestShot.impulse.x);
      const newAngle = currentAngle + noiseAngle;
      const len = bestShot.impulse.length();
      bestShot.impulse.x = Math.cos(newAngle) * len;
      bestShot.impulse.z = Math.sin(newAngle) * len;
    }

    // ── Fallback: если нет чистого пути, бьём в ближайшую фишку ──────────────
    if (!bestShot) {
      bestShot = this._buildFallbackShot(validTargets, difficulty);
    }

    return bestShot;
  }

  // ─── Оценка прямого удара ────────────────────────────────────────────────────

  _evaluateDirectShot(target, coinPos, pocket, contactDist, difficulty, diffMaxCutAngle, bodies) {
    const toPocketX = pocket.x - coinPos.x;
    const toPocketZ = pocket.z - coinPos.z;
    const distToPocket = Math.sqrt(toPocketX * toPocketX + toPocketZ * toPocketZ);
    if (distToPocket < 0.001) return null;

    const dirPocketX = toPocketX / distToPocket;
    const dirPocketZ = toPocketZ / distToPocket;

    const contactX = coinPos.x - dirPocketX * contactDist;
    const contactZ = coinPos.z - dirPocketZ * contactDist;

    if (!this._isSegmentClear(coinPos.x, coinPos.z, pocket.x, pocket.z, target.entry.body)) {
      return null;
    }

    const dz = PLAYER_2_LINE_Z - contactZ;

    let idealX = contactX;
    if (Math.abs(dirPocketZ) > 0.001) {
      idealX = contactX + dz * (dirPocketX / dirPocketZ);
    }
    idealX = THREE.MathUtils.clamp(idealX, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X);

    return this._scanAndScore(
      idealX, contactX, contactZ, distToPocket, dirPocketX, dirPocketZ, 
      target, difficulty, diffMaxCutAngle, bodies, false
    );
  }

  // ─── Оценка удара через борт (Bank Shot) ─────────────────────────────────────

  _evaluateBankShot(target, coinPos, pocket, contactDist, difficulty, diffMaxCutAngle, bodies) {
    const minZ = this.orchestrator.physics.boardBounds ? this.orchestrator.physics.boardBounds.minZ : -0.33;
    const bounceZ = minZ + PHYSICS.strikerDia / 2;

    const toPocketX = pocket.x - coinPos.x;
    const toPocketZ = pocket.z - coinPos.z;
    const distToPocket = Math.sqrt(toPocketX * toPocketX + toPocketZ * toPocketZ);
    if (distToPocket < 0.001) return null;

    const dirPocketX = toPocketX / distToPocket;
    const dirPocketZ = toPocketZ / distToPocket;

    const contactX = coinPos.x - dirPocketX * contactDist;
    const contactZ = coinPos.z - dirPocketZ * contactDist;

    if (!this._isSegmentClear(coinPos.x, coinPos.z, pocket.x, pocket.z, target.entry.body)) {
      return null;
    }

    if (contactZ > PLAYER_2_LINE_Z + 0.05) return null;

    const dZ1 = PLAYER_2_LINE_Z - bounceZ;
    const dZ2 = contactZ - bounceZ;
    if (dZ1 < 0.001 || dZ2 < 0.001) return null;

    const ratio = dZ1 / (dZ1 + dZ2);
    let idealX = contactX; 

    return this._scanAndScore(
      idealX, contactX, contactZ, distToPocket, dirPocketX, dirPocketZ, 
      target, difficulty, diffMaxCutAngle, bodies, true, bounceZ
    );
  }

  // ─── Общее сканирование позиций и скоринг ────────────────────────────────────

  _scanAndScore(idealX, contactX, contactZ, distToPocket, dirPocketX, dirPocketZ, 
                target, difficulty, diffMaxCutAngle, bodies, isBankShot, bounceZ = 0) {
    const scanMin = Math.max(PLAYER_LINE_MIN_X, idealX - X_SCAN_RADIUS);
    const scanMax = Math.min(PLAYER_LINE_MAX_X, idealX + X_SCAN_RADIUS);

    let bestLocalShot = null;
    let bestLocalScore = Infinity;

    for (let x = scanMin; x <= scanMax; x += X_SCAN_STEP) {
      if (!this._isPlacementValid(x, bodies)) continue;

      let dirHitX, dirHitZ, distToContact;
      let cutAngle;

      if (isBankShot) {
        const dZ1 = PLAYER_2_LINE_Z - bounceZ;
        const dZ2 = contactZ - bounceZ;
        const ratio = dZ1 / (dZ1 + dZ2);
        
        const hitBordX = x + (contactX - x) * ratio;
        
        const toBoardX = hitBordX - x;
        const toBoardZ = bounceZ - PLAYER_2_LINE_Z;
        const dist1 = Math.sqrt(toBoardX * toBoardX + toBoardZ * toBoardZ);
        
        const toContactX = contactX - hitBordX;
        const toContactZ = contactZ - bounceZ;
        const dist2 = Math.sqrt(toContactX * toContactX + toContactZ * toContactZ);
        
        if (dist1 < 0.001 || dist2 < 0.001) continue;
        
        dirHitX = toBoardX / dist1;
        dirHitZ = toBoardZ / dist1;
        distToContact = dist1 + dist2;

        const afterBounceDirX = toContactX / dist2;
        const afterBounceDirZ = toContactZ / dist2;

        const dot = afterBounceDirX * dirPocketX + afterBounceDirZ * dirPocketZ;
        cutAngle = Math.acos(Math.min(1.0, Math.max(-1.0, dot)));

        const strikerBody = this.orchestrator.rules.strikerEntry.body;
        if (!this._isSegmentClear(x, PLAYER_2_LINE_Z, hitBordX, bounceZ, strikerBody)) continue;
        if (!this._isSegmentClear(hitBordX, bounceZ, contactX, contactZ, strikerBody, target.entry.body)) continue;

      } else {
        const toContactX = contactX - x;
        const toContactZ = contactZ - PLAYER_2_LINE_Z;
        distToContact = Math.sqrt(toContactX * toContactX + toContactZ * toContactZ);
        if (distToContact < 0.001) continue;

        dirHitX = toContactX / distToContact;
        dirHitZ = toContactZ / distToContact;

        const dot = dirHitX * dirPocketX + dirHitZ * dirPocketZ;
        cutAngle = Math.acos(Math.min(1.0, Math.max(-1.0, dot)));

        const strikerBody = this.orchestrator.rules.strikerEntry.body;
        if (!this._isSegmentClear(x, PLAYER_2_LINE_Z, contactX, contactZ, strikerBody, target.entry.body)) continue;
      }

      if (cutAngle > diffMaxCutAngle) continue;

      const totalDist = distToContact + distToPocket;
      let score = totalDist + cutAngle * CUT_ANGLE_WEIGHT;

      if (target.isQueen) score -= QUEEN_BONUS;
      if (isBankShot) score += BANK_SHOT_PENALTY;
      if (!isBankShot && dirHitZ < 0) score += BACKWARD_SHOT_PENALTY;

      // Избегаем идеально прямых ударов, чтобы биток не падал вслед за фишкой (скретч)
      if (!isBankShot && cutAngle < 0.08) {
        score += 0.5; // Штраф за слишком прямой удар
      }

      if (score < bestLocalScore) {
        bestLocalScore = score;
        
        const finalForce = this._calculateForce(distToContact, distToPocket, cutAngle, difficulty, isBankShot);

        bestLocalShot = {
          strikerX: x,
          impulse: new THREE.Vector3(dirHitX, 0, dirHitZ).multiplyScalar(finalForce),
        };
      }
    }

    return bestLocalShot ? { shot: bestLocalShot, score: bestLocalScore } : null;
  }

  // ─── Вычисление силы удара ───────────────────────────────────────────────────

  _calculateForce(distToContact, distToPocket, cutAngle, difficulty, isBankShot = false) {
    if (this.orchestrator.rules._isFirstStrike) {
      return PHYSICS.maxPullDistance;
    }

    let GLOBAL_FORCE_MULTIPLIER = 0.4; // <- Коэффициент снижения силы всех ударов
    
    // При ударе от борта часть энергии гасится, поэтому бьем сильнее
    if (isBankShot) {
      GLOBAL_FORCE_MULTIPLIER *= 1.5; 
    }

    const MULTIPLIER = 2.0 * GLOBAL_FORCE_MULTIPLIER;
    const baseForce = 0.015 * GLOBAL_FORCE_MULTIPLIER;
    const forceForDist = (distToContact * 0.08 + distToPocket * 0.04) * MULTIPLIER;
    
    let cutCompensation = 1.0;
    if (cutAngle > 0.01) {
        const cosAngle = Math.max(0.2, Math.cos(cutAngle));
        cutCompensation = 1.0 / cosAngle;
    }

    let force = baseForce + forceForDist * cutCompensation;
    
    if (difficulty === 1) force *= (1.0 + (Math.random() - 0.5) * 0.2);
    else if (difficulty === 2) force *= (1.0 + (Math.random() - 0.5) * 0.1);

    return THREE.MathUtils.clamp(force, 0.02, PHYSICS.maxPullDistance);
  }

  // ─── Определение разрешённых целей ───────────────────────────────────────────

  /**
   * Возвращает массив объектов { entry, isQueen } с учётом правил Королевы.
   */
  _getValidTargets(state, myColor, bodies) {
    const queenState = state.queenState;
    const score = state.score;
    const targets = [];
    const myScore = myColor ? (score[myColor] || 0) : 0;

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

      // Свои фишки
      if (type === myColor) {
        // Если осталась последняя своя фишка (8 забито), а Королева еще на столе →
        // свою фишку забивать нельзя, иначе проигрыш/штраф!
        if (queenState === 'on_board' && myScore === 8) {
          continue; 
        }
        targets.push({ entry, isQueen: false });
        continue;
      }

      // Королева на столе
      if (type === 'queen' && queenState === 'on_board') {
        // Нельзя бить Королеву первым же ударом (пока нет забитых своих фишек)
        if (myScore === 0) continue;

        // Легально → добавляем с приоритетом (isQueen = true)
        targets.push({ entry, isQueen: true });
      }
    }

    return targets;
  }

  // ─── Fallback удар ───────────────────────────────────────────────────────────

  /**
   * Fallback: бьём прямо в ближайшую фишку из ближайшей валидной X-позиции.
   */
  _buildFallbackShot(validTargets, difficulty = 3) {
    if (validTargets.length === 0) return null;

    const bodies = this.orchestrator.physics.physicsBodies;
    
    // Пытаемся найти фишку, которая находится перед линией бота
    let forwardTargets = validTargets.filter(t => {
      const p = t.entry.body.translation();
      return (p.z - PLAYER_2_LINE_Z) > 0.05;
    });
    
    let targetList = forwardTargets.length > 0 ? forwardTargets : validTargets;
    
    // Выбираем случайную цель из списка, чтобы не зацикливаться
    const targetIdx = Math.floor(Math.random() * targetList.length);
    const fallbackTarget = targetList[targetIdx];
    const pos = fallbackTarget.entry.body.translation();

    // Бьем не точно в центр, а немного в сторону, чтобы "размазать" кучу 
    // или оттолкнуть фишку от борта под углом.
    const offsetLimit = PHYSICS.coinDia * 0.8; 
    const randomOffsetX = (Math.random() - 0.5) * 2 * offsetLimit;
    const aimX = pos.x + randomOffsetX;
    
    // Стараемся поставить биток не строго напротив фишки, чтобы добавить угол
    const randomPlacementOffset = (Math.random() - 0.5) * 0.1;
    let x = THREE.MathUtils.clamp(pos.x + randomPlacementOffset, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X);
    x = this._findNearestValidX(x, bodies);

    const dirX = aimX - x;
    const dirZ = pos.z - PLAYER_2_LINE_Z;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);

    // Если dirZ получается слишком мал (или назад), просто бьем по вектору
    let finalDirX = dirX / len;
    let finalDirZ = dirZ / len;

    // Сила удара: делаем чуть сильнее чтобы разорвать кластер
    let force = 0.06 + Math.random() * 0.04;
    if (this.orchestrator.rules._isFirstStrike) {
      force = PHYSICS.maxPullDistance;
    }
    
    // Вносим шум и в fallback
    if (difficulty === 1) force *= (1.0 + (Math.random() - 0.5) * 0.2);
    else if (difficulty === 2) force *= (1.0 + (Math.random() - 0.5) * 0.1);

    return {
      strikerX: x,
      impulse: new THREE.Vector3(finalDirX, 0, finalDirZ).multiplyScalar(force),
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
