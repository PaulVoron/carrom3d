/**
 * GameRulesManager.js
 * Стейт-машина + правила Каррома.
 * Читает и пишет только в Zustand store (useGameStore.getState()).
 * Не знает о DOM, React, Three.js-рендере.
 */

import gsap from 'gsap';
import RAPIER from '@dimforge/rapier3d-compat';
import { useGameStore, recordPocket } from '../store/useGameStore.js';
import { PHYSICS } from './PhysicsEngine.js';
import { PLAYER_1_LINE_Z, PLAYER_2_LINE_Z } from './InputController.js';
import { START_CAMERA_POSITION } from './3d-scene-settings.js';

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

    this._checkSleepFrameCount = 0;

    /** Ссылка на биток {mesh, body} */
    this.strikerEntry = null;
    this.strikerSpawnY = 0;
    this.strikerRadius = 0;
    this.coinRadius = 0;

    /** Линия прицеливания (THREE.ArrowHelper) */
    this.aimLine = null;
  }

  // ─── Инициализация ──────────────────────────────────────────────────────────

  setStrikerData(entry, spawnY, strikerRadius, coinRadius) {
    this.strikerEntry = entry;
    this.strikerSpawnY = spawnY;
    this.strikerRadius = strikerRadius;
    this.coinRadius = coinRadius;
  }

  setupAimLine(THREE) {
    const { ArrowHelper, Vector3 } = THREE;
    this.aimLine = new ArrowHelper(
      new Vector3(0, 0, -1),
      new Vector3(0, 0, 0),
      0.1,
      0xff0000,
      0.02,
      0.01
    );
    this.aimLine.visible = false;
    this.render.scene.add(this.aimLine);
  }

  // ─── RAF-вызов ───────────────────────────────────────────────────────────────

  /**
   * Вызывается каждый кадр из GameOrchestrator (RAF).
   * Обновляет визуал прицеливания и логику завершения хода.
   */
  tick() {
    const phase = useGameStore.getState().gamePhase;

    // ── Визуал прицеливания ──────────────────────────────────────────────
    if (phase === 'AIMING' && this.aimLine && this.strikerEntry) {
      const imp = this.input.currentImpulse;
      if (imp.lengthSq() > 0.00001) {
        this.aimLine.visible = true;
        this.aimLine.position.copy(this.strikerEntry.mesh.position);
        this.aimLine.position.y += 0.001;
        this.aimLine.setDirection(imp.clone().normalize());
        this.aimLine.setLength(imp.length() * 2);
      } else {
        this.aimLine.visible = false;
      }
    } else if (this.aimLine) {
      this.aimLine.visible = false;
    }

    // ── Проверка окончания хода ──────────────────────────────────────────
    if (phase === 'MOVING') {
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
      console.log('⚠️ Биток попал в лузу!');
    } else if (type === 'queen') {
      recordPocket('queen');
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
      body.setEnabled(false);
      mesh.visible = false;
      console.log('👑 Королева забита!');
    } else if (type === 'white' || type === 'black') {
      const ownColor = currentPlayer === 1 ? 'white' : 'black';
      recordPocket(type === ownColor ? 'own' : 'opponent');
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
      body.setEnabled(false);
      mesh.visible = false;
      console.log(`🎯 ${type} фишка забита игроком ${currentPlayer}`);
    }
  }

  // ─── Завершение хода ─────────────────────────────────────────────────────────

  _endTurn() {
    console.log('🎱 Ход завершён → оцениваем...');
    this._checkSleepFrameCount = 0;

    // Вычисляем итог хода (обновляет стор атомарно)
    const nextPlayer = useGameStore.getState().evaluateTurn();

    // Поворачиваем камеру к следующему игроку
    this._rotateCameraForPlayer(nextPlayer);

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
  }

  _validateInitialPlacement(player) {
    const z = player === 1 ? PLAYER_1_LINE_Z : PLAYER_2_LINE_Z;
    const hasOverlap = this.input.checkPlacementOverlap(
      0, z,
      this.physics.physicsBodies,
      this.strikerEntry,
      this.strikerRadius,
      this.coinRadius
    );
    useGameStore.getState().setPlacementBlocked(hasOverlap);
    this._setStrikerOverlapVisual(hasOverlap);
  }

  // ─── Подтверждение расстановки ───────────────────────────────────────────────

  confirmPlacement() {
    const { gamePhase } = useGameStore.getState();
    if (gamePhase !== 'PLACEMENT' || !this.strikerEntry) return;

    const currentPos = this.strikerEntry.mesh.position.clone();
    useGameStore.getState().setGamePhase('AIMING');
    this.input.setGamePhase('AIMING');
    this.physics.resetAccumulator();
    this.physics.makeStrikerDynamic(this.strikerEntry, currentPos);
    console.log(`🎱 PLACEMENT → AIMING: биток на X=${currentPos.x.toFixed(3)}`);
  }

  // ─── Удар ────────────────────────────────────────────────────────────────────

  shoot(impulseVec) {
    const { gamePhase } = useGameStore.getState();
    if (gamePhase !== 'AIMING') return;

    this.physics.wakeAll();
    const scaled = impulseVec.clone().multiplyScalar(PHYSICS.strikerForce);
    this.physics.applyImpulse(this.strikerEntry.body, scaled);

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

    const hasOverlap = this.input.checkPlacementOverlap(
      x, z,
      this.physics.physicsBodies,
      this.strikerEntry,
      this.strikerRadius,
      this.coinRadius
    );
    useGameStore.getState().setPlacementBlocked(hasOverlap);
    this._setStrikerOverlapVisual(hasOverlap);
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

  // ─── Анимация камеры ─────────────────────────────────────────────────────────

  _rotateCameraForPlayer(player) {
    const { camera, controls } = this.render;
    if (!camera || !controls) return;

    useGameStore.getState().setCameraAnimating(true);
    controls.enabled = false;

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
        controls.update();
        useGameStore.getState().setCameraAnimating(false);
      },
    });
  }
}
