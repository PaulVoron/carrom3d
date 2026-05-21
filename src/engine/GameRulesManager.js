/**
 * GameRulesManager.js
 * Стейт-машина + правила Каррома.
 * Читает и пишет только в Zustand store (useGameStore.getState()).
 * Не знает о DOM, React, Three.js-рендере.
 */

import gsap from 'gsap';
import RAPIER from '@dimforge/rapier3d-compat';
import { useGameStore, recordPocket } from '../store/useGameStore.js';
import { MASK_COIN_NORMAL } from './PhysicsEngine.js';
import { PLAYER_1_LINE_Z, PLAYER_2_LINE_Z } from './InputController.js';
import { START_CAMERA_POSITION } from './3d-scene-settings.js';
import { networkManager } from './NetworkManager.js';
import { audioManager } from './AudioManager.js';
import * as THREE from 'three';

export class GameRulesManager {
  /**
   * @param {import('./PhysicsEngine').PhysicsEngine} physicsEngine
   * @param {import('./RenderCore').RenderCore} renderCore
   * @param {import('./InputController').InputController} inputController
   */
  constructor(physicsEngine, renderCore, inputController) {
    this.physics = physicsEngine;
    this.render = renderCore;
    this.input = inputController;

    /** @type {import('./AudioManager').AudioManager} — аудиосистема */
    this.audio = audioManager;

    this._checkSleepFrameCount = 0;

    /** Ссылка на биток {mesh, body} */
    this.strikerEntry = null;
    this.strikerSpawnY = 0;
    this.strikerRadius = 0;
    this.strikerRadius = 0;
    this.coinRadius = 0;

    this._strikerHitSomething = false;
    this._lastPhase = 'PLACEMENT';
    this._lastCurrentPlayer = null;

    /** Флаг первого удара (разбой): сбрасывается после первого _endTurn() */
    this._isFirstStrike = true;

    this._setupNetworking();

    // Подключаем аудио-коллбэк к физике (нативные Rapier CONTACT_FORCE_EVENTS)
    this.physics.onContactForce = (e1, e2, f) => this._handleCollisionSound(e1, e2, f);
  }

  _setupNetworking() {
    networkManager.on('SYNC_PLACEMENT', (data) => {
      const { currentPlayer, networkMode } = useGameStore.getState();
      if (networkMode !== 'local') {
        this.onStrikerDrag(data.x, currentPlayer);
      }
    });

    networkManager.on('SYNC_AIM', (data) => {
      if (useGameStore.getState().networkMode !== 'local') {
        this.input.currentImpulse.set(data.impulse.x, data.impulse.y, data.impulse.z);
      }
    });

    networkManager.on('CONFIRM_PLACEMENT', () => {
      if (useGameStore.getState().networkMode !== 'local') {
        this.confirmPlacement(true);
      }
    });

    networkManager.on('STRIKE', (data) => {
      if (useGameStore.getState().networkMode !== 'local') {
        const vec = new THREE.Vector3(data.impulse.x, data.impulse.y, data.impulse.z);
        this.shoot(vec, true);
        this.input.currentImpulse.set(0, 0, 0);
      }
    });

    networkManager.on('SYNC_TURN_RESULT', (data) => {
      if (useGameStore.getState().networkMode === 'client') {
        this.physics.applySnapshot(data.snapshot);
        useGameStore.getState().syncStoreState(data.storeState);
        this._executeEndTurnReturns(data.storeState.currentPlayer, data.returns);
      }
    });

    networkManager.on('CLIENT_SELECT_COLOR', (data) => {
      const state = useGameStore.getState();
      if (state.networkMode === 'host') {
        state.selectPlayerColor(data.color);
        networkManager.send('SYNC_COLOR_SELECTION', {
          playerColors: useGameStore.getState().playerColors
        });
      }
    });

    networkManager.on('SYNC_COLOR_SELECTION', (data) => {
      if (useGameStore.getState().networkMode === 'client') {
        useGameStore.setState({
          playerColors: data.playerColors,
          showColorSelection: false,
          isPlacementBlocked: false
        });
      }
    });
  }

  // ─── Инициализация ──────────────────────────────────────────────────────────

  setStrikerData(entry, spawnY, strikerRadius, coinRadius) {
    this.strikerEntry = entry;
    this.strikerSpawnY = spawnY;
    this.strikerRadius = strikerRadius;
    this.coinRadius = coinRadius;

    // Сразу выставляем биток на линию текущего игрока после загрузки
    const currentPlayer = useGameStore.getState().currentPlayer;
    const resetPos = {
      x: 0,
      y: spawnY,
      z: currentPlayer === 1 ? PLAYER_1_LINE_Z : PLAYER_2_LINE_Z,
    };
    this.physics.restoreStriker(entry, resetPos);
    entry.mesh.position.set(resetPos.x, resetPos.y, resetPos.z);
    entry.mesh.quaternion.set(0, 0, 0, 1);
  }

  /**
   * Вызвать при старте новой игры.
   * Сбрасывает флаг разбоя и воспроизводит приветственный голос.
   */
  startGame() {
    this._isFirstStrike = true;
    // Голос запускается после того, как камера повернётся на позицию игрока (1.5s + 0.2s)
    setTimeout(() => {
      this.audio.playVoice('voice_start_game');
    }, 1700);
  }

  // ─── RAF-вызов ───────────────────────────────────────────────────────────────

  tick() {
    const phase = useGameStore.getState().gamePhase;
    const currentPlayer = useGameStore.getState().currentPlayer;

    // ─── Сброс флагов при смене фазы ───────────────────────────────────────────
    if (this._lastPhase !== phase) {
      if (phase === 'MOVING') {
        this._strikerHitSomething = false;
      }
      this._lastPhase = phase;
    }

    // ─── Инициализация камеры и битка (например, после жребия) ──────────────
    if (phase === 'PLACEMENT') {
      const mode = useGameStore.getState().networkMode;
      const role = useGameStore.getState().localPlayerRole;
      const cameraPlayer = mode === 'local' ? currentPlayer : role;

      if (this._lastCurrentPlayer !== currentPlayer) {
        this._rotateCameraForPlayer(cameraPlayer);
        this._lastCurrentPlayer = currentPlayer;

        if (this.strikerEntry) {
          const resetPos = {
            x: 0,
            y: this.strikerSpawnY,
            z: currentPlayer === 1 ? PLAYER_1_LINE_Z : PLAYER_2_LINE_Z,
          };
          this.physics.restoreStriker(this.strikerEntry, resetPos);
          this.strikerEntry.mesh.position.set(resetPos.x, resetPos.y, resetPos.z);
          this.strikerEntry.mesh.quaternion.set(0, 0, 0, 1);
          
          this._validateInitialPlacement(currentPlayer);
        }
      }
    }

    // ── Визуал прицеливания ──────────────────────────────────────────────
    if (phase === 'AIMING' && this.render.aimBar && this.strikerEntry) {
      const imp = this.input.currentImpulse;
      if (imp.lengthSq() > 0.00001) {
        this.render.aimBar.visible = true;
        this.render.aimBar.position.copy(this.strikerEntry.mesh.position);
        this.render.aimBar.position.y = 0; // Фиксируем высоту над столом для исключения Z-fighting

        // Направляем полосу в сторону удара
        this.render.aimBar.rotation.y = Math.atan2(imp.x, imp.z);

        // Сила натяжения (расстояние оттяжки)
        const pullDistance = imp.length();
        const maxDist = 0.25; // PHYSICS.maxPullDistance fallback
        const ratio = Math.min(1.0, pullDistance / maxDist);

        // Растет вперед
        this.render.aimBarMesh.scale.y = pullDistance * 2.0;

        // Расширяется в стороны (максимум до диаметра битка)
        const minWidth = 0.01;
        const maxWidth = 0.0413; // PHYSICS.strikerDia fallback
        this.render.aimBarMesh.scale.x = minWidth + ratio * (maxWidth - minWidth);
      } else {
        this.render.aimBar.visible = false;
      }
    } else if (this.render.aimBar) {
      this.render.aimBar.visible = false;
    }

    // ── Проверка окончания хода и попаданий ──────────────────────────────
    if (phase === 'MOVING') {
      // Проверка на попадание по фишке
      if (!this._strikerHitSomething) {
        for (const entry of this.physics.physicsBodies) {
          if (entry.mesh.userData.type === 'striker') continue;
          if (!entry.body.isEnabled()) continue;
          
          const v = entry.body.linvel();
          const sq = v.x * v.x + v.y * v.y + v.z * v.z;
          if (sq > 0.0001) {
            this._strikerHitSomething = true;
            console.log('💥 Биток коснулся фишки!');
            break;
          }
        }
      }

      this._checkSleepFrameCount++;
      if (this._checkSleepFrameCount % 30 === 0) {
        if (this.physics.areAllSleeping()) {
          this._endTurn();
        }
      }
    }
  }

  // ─── Обработка попадания в лузу ─────────────────────────────────────────────

  /**
   * Вызывается из PhysicsEngine.onPocketEnter.
   * @param {{mesh: THREE.Object3D, body: RAPIER.RigidBody}} entry
   */
  handlePocketResult(entry) {
    const { mesh, body } = entry;
    const { currentPlayer } = useGameStore.getState();
    const type = mesh.userData.type;

    if (type === 'striker') {
      recordPocket('foul');
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
      body.setEnabled(false);
      mesh.visible = false;
      mesh.userData.pocketed = true;
      // [AUDIO] Биток в лузу
      this.audio.playPositional(mesh, 'sfx_striker_pocket_drop', 1.0);
      console.log('⚠️ Биток попал в лузу!');
    } else if (type === 'queen') {
      recordPocket('queen');
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
      body.setEnabled(false);
      mesh.visible = false;
      // [AUDIO] Физический звук
      this.audio.playPositional(mesh, 'sfx_coin_pocket_drop', 1.0);
      console.log('👑 Королева забита!');
    } else if (type === 'white' || type === 'black') {
      recordPocket(type);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
      body.setEnabled(false);
      mesh.visible = false;
      // [AUDIO] Звук падения
      this.audio.playPositional(mesh, 'sfx_coin_pocket_drop', 1.0);
      console.log(`🎯 ${type} фишка забита игроком ${currentPlayer}`);
    }
  }

  handleOutOfBounds(entry) {
    const type = entry.mesh.userData.type;
    const body = entry.body;
    const mesh = entry.mesh;

    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.sleep();
    body.setEnabled(false);
    mesh.visible = false;
    
    console.log(`🚀 ${type} улетел за борт!`);
    useGameStore.getState().recordOutOfBounds(type);
  }

  // ─── Завершение хода ─────────────────────────────────────────────────────────

  _endTurn() {
    console.log('🎱 Ход завершён → оцениваем...');
    this._checkSleepFrameCount = 0;

    const { networkMode } = useGameStore.getState();
    
    if (networkMode === 'client') {
      console.log('⏳ Ожидание SYNC_TURN_RESULT от хоста...');
      return;
    }

    // ── [AUDIO] Захват состояния ДО evaluateTurn (после него turnEvents сбрасываются) ────────
    const preState      = useGameStore.getState();
    const prevQueenState   = preState.queenState;
    const prevPlayer       = preState.currentPlayer;
    const te               = preState.turnEvents;
    const isFoulPre        = te.isFoul;
    const ownPocketed      = te.pocketedWhite + te.pocketedBlack; // для applause
    // ────────────────────────────────────────────────────────────────────────────

    // Host or Local
    const snapshot    = this.physics.getSnapshot();
    const hitSomething = this._strikerHitSomething;
    
    const { nextPlayer, returns } = useGameStore.getState().evaluateTurn({ hitSomething });

    // ── [AUDIO] Состояние ПОСЛЕ evaluateTurn ──────────────────────────────────────
    const postState        = useGameStore.getState();
    const winner           = postState.winner;
    const queenJustCovered = prevQueenState !== 'covered' && postState.queenState === 'covered';
    const playerChanged    = prevPlayer !== nextPlayer;
    // ────────────────────────────────────────────────────────────────────────────
    
    const assignedPositions = [];
    const returnsWithPos = returns.map(ret => {
      if (ret.type === 'queen') {
        const pos = this.physics.getFreePosition(true, this.coinRadius, assignedPositions);
        assignedPositions.push({ x: pos.x, z: pos.z, r: this.coinRadius });
        return { ...ret, pos };
      }
      if (ret.type === 'coin') {
        const positions = [];
        for (let i = 0; i < ret.count; i++) {
          const pos = this.physics.getFreePosition(false, this.coinRadius, assignedPositions);
          assignedPositions.push({ x: pos.x, z: pos.z, r: this.coinRadius });
          positions.push(pos);
        }
        return { ...ret, positions };
      }
      return ret;
    });

    if (networkMode === 'host') {
      const storeState = useGameStore.getState();
      networkManager.send('SYNC_TURN_RESULT', {
        snapshot,
        returns: returnsWithPos,
        storeState: {
          score: storeState.score,
          playerColors: storeState.playerColors,
          dueDebt: storeState.dueDebt,
          queenState: storeState.queenState,
          queenCoveredBy: storeState.queenCoveredBy,
          winner: storeState.winner,
          gameOverScore: storeState.gameOverScore,
          consecutiveMisses: storeState.consecutiveMisses,
          currentPlayer: storeState.currentPlayer,
          turnEvents: storeState.turnEvents,
          gamePhase: storeState.gamePhase,
          lastStartingPlayer: storeState.lastStartingPlayer,
          colorAssignmentAlert: storeState.colorAssignmentAlert,
          showColorSelection: storeState.showColorSelection,
          isPlacementBlocked: storeState.isPlacementBlocked
        }
      });
    }

    // ── [AUDIO] Воспроизводим звуки по итогам хода ────────────────────────────────
    if (winner) {
      // Победа: аплодисменты + голос win/lose
      this.audio.playGlobal('ui_applause', 0.3);
      const localRole = postState.localPlayerRole;
      const isLocalWin = localRole === null || localRole === winner;
      this.audio.playVoice(isLocalWin ? 'voice_you_win' : 'voice_you_lose');
    } else {
      if (isFoulPre) {
        setTimeout(() => this.audio.playVoice('voice_foul'), 500);
      } else {
        if (te.pocketedQueen) {
          this.audio.playVoice('voice_queen_pocketed');
        } else if (te.pocketedWhite > 0 || te.pocketedBlack > 0) {
          if (Math.random() < 0.3) {
            this.audio.playVoice('voice_wow');
          }
        }
      }
      if (queenJustCovered) {
        this.audio.playVoice('voice_queen_covered');
      }
      // Аплодисменты: разбой (первый удар + хотя бы одна фишка) или 2+ фишки за удар
      if ((this._isFirstStrike && ownPocketed > 0) || ownPocketed >= 2) {
        this.audio.playGlobal('ui_applause', 0.3);
      }
      // Переход хода (только если ход реально перешёл)
      if (playerChanged && !postState.showColorSelection) {
        this.audio.playGlobal('ui_turn_switch', 0.3);
      }
    }
    // Сбрасываем флаг разбоя после первого хода
    if (this._isFirstStrike) this._isFirstStrike = false;
    // ────────────────────────────────────────────────────────────────────────────

    this._executeEndTurnReturns(nextPlayer, returnsWithPos);
  }

  _executeEndTurnReturns(nextPlayer, returns) {
    this._processReturns(returns, () => {
      // Поворачиваем камеру к следующему игроку после выставления штрафов
      const mode = useGameStore.getState().networkMode;
      const role = useGameStore.getState().localPlayerRole;
      const cameraPlayer = mode === 'local' ? nextPlayer : role;

      if (this._lastCurrentPlayer !== nextPlayer) {
        this._rotateCameraForPlayer(cameraPlayer);
        this._lastCurrentPlayer = nextPlayer;
      }
      // Восстанавливаем биток
      if (this.strikerEntry) {
        if (this.strikerEntry.mesh.userData.pocketed || !this.strikerEntry.body.isEnabled()) {
          console.log('🔄 Биток восстановлен из лузы.');
          this.strikerEntry.mesh.visible = true;
          this.strikerEntry.mesh.userData.pocketed = false;
        }

        const resetPos = {
          x: 0,
          y: this.strikerSpawnY,
          z: nextPlayer === 1 ? PLAYER_1_LINE_Z : PLAYER_2_LINE_Z,
        };

        this.physics.restoreStriker(this.strikerEntry, resetPos);
        this.strikerEntry.mesh.position.set(resetPos.x, resetPos.y, resetPos.z);
        this.strikerEntry.mesh.quaternion.set(0, 0, 0, 1);
      }

      // Сбрасываем аккумулятор физики
      this.physics.resetAccumulator();

      // Стор уже переведён в PLACEMENT внутри evaluateTurn()
      this.input.setGamePhase('PLACEMENT');

      // Запускаем начальную валидацию
      this._validateInitialPlacement(nextPlayer);
    });
  }

  _processReturns(returns, onComplete) {
    if (!returns || returns.length === 0) {
      onComplete();
      return;
    }

    let completed = 0;
    let totalAnims = 0;

    const checkDone = () => {
      completed++;
      if (completed >= totalAnims) {
        onComplete();
      }
    };

    returns.forEach(ret => {
      if (ret.type === 'queen') {
        const queenEntry = this.physics.physicsBodies.find(e => e.mesh.userData.type === 'queen');
        if (queenEntry) {
          totalAnims++;
          this._animateReturn(queenEntry, true, ret.pos, checkDone);
        }
      } else if (ret.type === 'coin') {
        const color = ret.color;
        let count = ret.count;
        const availableCoins = this.physics.physicsBodies.filter(e => 
          e.mesh.userData.type === color && !e.body.isEnabled() && !e.mesh.visible
        );
        for (let i = 0; i < Math.min(count, availableCoins.length); i++) {
          totalAnims++;
          this._animateReturn(availableCoins[i], false, ret.positions[i], checkDone);
        }
      }
    });

    if (totalAnims === 0) {
      onComplete();
    }
  }

  _animateReturn(entry, isQueen, pos, onComplete) {
    if (!pos) {
      onComplete();
      return;
    }
    
    entry.body.setEnabled(false);
    entry.mesh.visible = true;
    entry.mesh.quaternion.set(0, 0, 0, 1); // Сбрасываем поворот
    entry.mesh.position.set(pos.x, 0.05, pos.z); // Ниже левитация (было 0.15)

    // [AUDIO] Звук появления штрафной фишки (не для Королевы)
    if (!isQueen) {
      this.audio.playGlobal('ui_due_spawn');
    }
    
    const originalMaterials = [];
    entry.mesh.traverse(c => {
      if (c.isMesh) {
        originalMaterials.push({ mesh: c, mat: c.material });
        c.material = c.material.clone();
        c.material.transparent = true;
        c.material.opacity = 0;
      }
    });

    const tl = gsap.timeline({
      onComplete: () => {
        originalMaterials.forEach(({ mesh, mat }) => {
          mesh.material.dispose();
          mesh.material = mat;
        });

        entry.body.setTranslation({ x: pos.x, y: 0.005, z: pos.z }, true);
        entry.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); // Сбрасываем физический поворот
        entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        entry.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        
        const collider = entry.body.collider(0);
        if (collider) collider.setCollisionGroups(MASK_COIN_NORMAL);

        entry.body.setEnabled(true);
        entry.body.wakeUp();

        onComplete();
      }
    });

    const mats = originalMaterials.map(item => item.mesh.material);
    tl.to(mats, {
      opacity: 1,
      duration: 0.1,
      yoyo: true,
      repeat: 9
    });
    
    tl.to(entry.mesh.position, {
      y: 0.005,
      duration: 0.8,
      ease: 'bounce.out'
    });
  }

  _validateInitialPlacement(player) {
    const z = player === 1 ? PLAYER_1_LINE_Z : PLAYER_2_LINE_Z;
    const isValid = this.input.validatePlacement(
      0, z,
      this.physics.physicsBodies,
      this.strikerEntry,
      this.strikerRadius,
      this.coinRadius
    );
    useGameStore.getState().setPlacementBlocked(!isValid);
    this._setStrikerOverlapVisual(!isValid);
  }

  // ─── Подтверждение расстановки ───────────────────────────────────────────────

  confirmPlacement(isRemote = false) {
    const { gamePhase, networkMode } = useGameStore.getState();
    if (gamePhase !== 'PLACEMENT' || !this.strikerEntry) return;

    if (!isRemote && networkMode !== 'local') {
      networkManager.send('CONFIRM_PLACEMENT', {});
    }

    const currentPos = this.strikerEntry.mesh.position.clone();
    useGameStore.getState().setGamePhase('AIMING');
    this.input.setGamePhase('AIMING');
    this.physics.resetAccumulator();
    this.physics.makeStrikerDynamic(this.strikerEntry, currentPos);
    
    // [AUDIO] Звук на кнопку "Готовий до удару"
    this.audio.playGlobal('sfx_strike_0');
    
    console.log(`🎱 PLACEMENT → AIMING: биток на X=${currentPos.x.toFixed(3)}`);
  }

  // ─── Удар ────────────────────────────────────────────────────────────────────

  shoot(impulseVec, isRemote = false) {
    const { gamePhase, networkMode } = useGameStore.getState();
    if (gamePhase !== 'AIMING') return;

    if (!isRemote && networkMode !== 'local') {
      networkManager.send('STRIKE', { impulse: { x: impulseVec.x, y: impulseVec.y, z: impulseVec.z } });
    }

    this.physics.wakeAll();
    const scaled = impulseVec.clone().multiplyScalar(0.5); // PHYSICS.strikerForce fallback
    this.physics.applyImpulse(this.strikerEntry.body, scaled);

    // [AUDIO] Звук щелчка пальцем по битку
    this.audio.playPositional(this.strikerEntry.mesh, 'sfx_strike', 1.0);

    useGameStore.getState().setGamePhase('MOVING');
    this.input.setGamePhase('MOVING');
    this._checkSleepFrameCount = 0;
    console.log('🎱 AIMING → MOVING: удар!');
  }

  // ─── Drag-коллбэк ────────────────────────────────────────────────────────────

  onStrikerDrag(x, currentPlayer) {
    const z = currentPlayer === 1 ? PLAYER_1_LINE_Z : PLAYER_2_LINE_Z;

    this.strikerEntry.body.setNextKinematicTranslation(
      { x, y: this.strikerSpawnY, z }, true
    );
    this.strikerEntry.mesh.position.set(x, this.strikerSpawnY, z);

    const isValid = this.input.validatePlacement(
      x, z,
      this.physics.physicsBodies,
      this.strikerEntry,
      this.strikerRadius,
      this.coinRadius
    );
    useGameStore.getState().setPlacementBlocked(!isValid);
    this._setStrikerOverlapVisual(!isValid);
  }

  // ─── Визуальная обратная связь ───────────────────────────────────────────────

  _setStrikerOverlapVisual(isOverlapping) {
    if (!this.strikerEntry) return;
    this.strikerEntry.mesh.traverse(child => {
      if (!child.isMesh) return;
      if (isOverlapping) {
        if (!child.userData._origColor) {
          child.userData._origColor = child.material.color.getHex();
        }
        child.material.color.set(0xff3333);
        child.material.transparent = true;
        child.material.opacity = 0.6;
      } else {
        if (child.userData._origColor !== undefined) {
          child.material.color.set(child.userData._origColor);
        }
        child.material.transparent = false;
        child.material.opacity = 1.0;
      }
    });
  }

  // ─── Анимация камеры ───────────────────────────────────────────────────────────────

  _rotateCameraForPlayer(player) {
    const { camera, controls } = this.render;
    if (!camera || !controls) return;

    useGameStore.getState().setCameraAnimating(true);
    controls.enabled = false;
    
    // Снимаем лимиты перед анимацией, чтобы OrbitControls не блокировал вращение на 180
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;

    const tx = player === 1 ? START_CAMERA_POSITION[0] : -START_CAMERA_POSITION[0];
    const ty = START_CAMERA_POSITION[1];
    const tz = player === 1 ? START_CAMERA_POSITION[2] : -START_CAMERA_POSITION[2];

    gsap.to(controls.target, {
      x: 0, y: 0, z: 0,
      duration: 1.5,
      ease: 'power2.inOut',
      onUpdate: () => controls.update(),
    });

    const startAngle = Math.atan2(camera.position.z, camera.position.x);
    let endAngle = Math.atan2(tz, tx);
    let diff = endAngle - startAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    endAngle = startAngle + diff;

    const proxy = {
      angle: startAngle,
      radius: Math.hypot(camera.position.x, camera.position.z),
      y: camera.position.y,
    };

    gsap.to(proxy, {
      angle: endAngle,
      radius: Math.hypot(tx, tz),
      y: ty,
      duration: 1.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.x = proxy.radius * Math.cos(proxy.angle);
        camera.position.z = proxy.radius * Math.sin(proxy.angle);
        camera.position.y = proxy.y;
        controls.update();
      },
      onComplete: () => {
        controls.enabled = true;
        this.render.setCameraAzimuthLimits(player);
        controls.update();
        useGameStore.getState().setCameraAnimating(false);
      },
    });
  }

  // ─── Аудио коллизий ──────────────────────────────────────────────────────────

  /**
   * Обрабатывает событие контактной силы от PhysicsEngine.
   * Вызывается из physics.onContactForce при каждом дрейне EventQueue.
   *
   * Логика определения звука:
   *  - entry = null → пол или крыша (не зарегистрированы) → пропускаем
   *  - один тип 'wall' + другой 'striker' → sfx_striker_wall_hit
   *  - один тип 'wall' + другой coin/queen → sfx_coin_wall_hit
   *  - оба coin/queen → sfx_coin_hit
   *  - striker + coin → ничего (sfx_strike уже играет из shoot())
   *
   * @param {object|null} entry1
   * @param {object|null} entry2
   * @param {number}      force — totalForceMagnitude из Rapier
   */
  _handleCollisionSound(entry1, entry2, force) {
    // Пол, крыша или неизвестный объект → нет звука
    if (!entry1 || !entry2) return;

    const t1 = entry1.mesh?.userData?.type;
    const t2 = entry2.mesh?.userData?.type;
    if (!t1 || !t2) return;

    const isWall1 = t1 === 'wall';
    const isWall2 = t2 === 'wall';

    let soundKey  = null;
    let soundEntry = entry1;

    if (isWall1 || isWall2) {
      // Один из объектов — борт
      soundEntry = isWall1 ? entry2 : entry1;
      const coinType = soundEntry.mesh.userData.type;

      if (coinType === 'striker') {
        soundKey = 'sfx_striker_wall_hit';
      } else if (coinType === 'white' || coinType === 'black' || coinType === 'queen') {
        soundKey = 'sfx_coin_wall_hit';
      }
    } else {
      // Оба объекта — фишки или биток
      const hasStriker = t1 === 'striker' || t2 === 'striker';
      if (hasStriker) {
        // Удар битка о фишку после разбоя.
        // sfx_strike уже сыграл в shoot() — здесь молчим.
        return;
      }
      // Фишка о фишку
      soundKey  = 'sfx_coin_hit';
      soundEntry = entry1;
    }

    if (!soundKey) return;
    this.audio.playPositional(soundEntry.mesh, soundKey, force);
  }
}
