/**
 * InputController.js
 * Обрабатывает все события указателя (мышь / тач).
 * Знает о Three.js (Raycaster), но не знает о React / физике.
 */

import * as THREE from 'three';
import { PHYSICS } from './PhysicsEngine.js';
import { useGameStore } from '../store/useGameStore.js';
import { networkManager } from './NetworkManager.js';
import { audioManager } from './AudioManager.js';

export const PLAYER_1_LINE_Z  =  0.25;
export const PLAYER_2_LINE_Z  = -0.25;
export const PLAYER_LINE_MIN_X = -0.218;
export const PLAYER_LINE_MAX_X =  0.218;

export class InputController {
  constructor() {
    this._camera   = null;
    this._controls = null;
    this._canvas   = null;
    this._raycaster  = new THREE.Raycaster();
    this._pointerNDC = new THREE.Vector2();
    this._dragPlane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._isDragging = false;
    this._isAiming   = false;
    this._lastSyncTime = 0;
    this.currentImpulse = new THREE.Vector3();
    this._aimStart = new THREE.Vector3();
    this._strikerEntry  = null;
    this._strikerSpawnY = 0;
    this._gamePhase = 'PLACEMENT';
    /** X-позиция предыдущего движения (для slide-звука) */
    this._lastSlideX = null;

    /** Коллбэки (устанавливает GameOrchestrator) */
    this.onStrikerDrag = null;
    this.onShoot = null;
    this.onConfirmPlacement = null;
  }

  attach(canvas, camera, controls) {
    this._canvas   = canvas;
    this._camera   = camera;
    this._controls = controls;
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup',   this._onUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  detach() {
    if (!this._canvas) return;
    this._canvas.removeEventListener('pointerdown', this._onDown);
    this._canvas.removeEventListener('pointermove', this._onMove);
    this._canvas.removeEventListener('pointerup',   this._onUp);
    window.removeEventListener('keydown', this._onKeyDown);
  }

  setStrikerEntry(entry, strikerSpawnY) {
    this._strikerEntry  = entry;
    this._strikerSpawnY = strikerSpawnY;
  }

  setGamePhase(phase) { this._gamePhase = phase; }

  _isLocalPlayerActive() {
    const mode = useGameStore.getState().networkMode;
    const player = useGameStore.getState().currentPlayer;
    const role = useGameStore.getState().localPlayerRole;
    const gameMode = useGameStore.getState().gameMode;
    const { isPyramidLocked, score } = useGameStore.getState();

    if (gameMode === 'pve' && player === 2) return false;

    // Блокируем ввод пока пирамида не заблокирована (на первом ходу)
    const isFirstTurn = score.white === 0 && score.black === 0;
    if (isFirstTurn && !isPyramidLocked) return false;

    if (mode === 'local') return true;
    if (mode !== 'local' && player === role) return true;
    return false;
  }

  _onDown = (event) => {
    if (!this._strikerEntry || !this._isLocalPlayerActive()) return;
    this._updateNDC(event);
    this._raycaster.setFromCamera(this._pointerNDC, this._camera);
    const hits = this._raycaster.intersectObject(this._strikerEntry.mesh, true);
    if (hits.length === 0) return;

    if (this._gamePhase === 'PLACEMENT') {
      this._isDragging = true;
      if (this._controls) this._controls.enabled = false;
      this._dragPlane.set(new THREE.Vector3(0, 1, 0), -this._strikerSpawnY);
    } else if (this._gamePhase === 'AIMING') {
      this._isAiming = true;
      if (this._controls) this._controls.enabled = false;
      this._dragPlane.set(new THREE.Vector3(0, 1, 0), -this._strikerSpawnY);
      const hit = new THREE.Vector3();
      this._raycaster.ray.intersectPlane(this._dragPlane, hit);
      this._aimStart.copy(hit);
    }
  };

  _onMove = (event) => {
    if (!this._strikerEntry || !this._isLocalPlayerActive()) return;
    this._updateNDC(event);
    this._raycaster.setFromCamera(this._pointerNDC, this._camera);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._dragPlane, hit)) return;

    if (this._gamePhase === 'PLACEMENT' && this._isDragging) {
      const x = THREE.MathUtils.clamp(hit.x, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X);

      // [AUDIO] Звук шуршания только если биток реально сдвинулся
      if (this._lastSlideX !== null) {
        const dx = Math.abs(x - this._lastSlideX);
        if (dx > 0.0005) {
          audioManager.startSlide();
          
          // Если мышь остановилась, но не отпущена - звук затухает
          if (this._slideStopTimeout) clearTimeout(this._slideStopTimeout);
          this._slideStopTimeout = setTimeout(() => {
            audioManager.stopSlide(150);
          }, 100);
        }
      }
      this._lastSlideX = x;

      if (this.onStrikerDrag) this.onStrikerDrag(x);
      
      if (useGameStore.getState().networkMode !== 'local') {
        const now = Date.now();
        if (now - this._lastSyncTime > 50) {
          networkManager.send('SYNC_PLACEMENT', { x });
          this._lastSyncTime = now;
        }
      }
    } else if (this._gamePhase === 'AIMING' && this._isAiming) {
      const pull = new THREE.Vector3().subVectors(hit, this._aimStart);
      if (pull.length() > PHYSICS.maxPullDistance) pull.setLength(PHYSICS.maxPullDistance);
      this.currentImpulse.copy(pull).multiplyScalar(-1);

      if (useGameStore.getState().networkMode !== 'local') {
        const now = Date.now();
        if (now - this._lastSyncTime > 50) {
          networkManager.send('SYNC_AIM', { impulse: { x: this.currentImpulse.x, y: this.currentImpulse.y, z: this.currentImpulse.z } });
          this._lastSyncTime = now;
        }
      }
    }
  };

  _onUp = () => {
    if (!this._isLocalPlayerActive()) return;
    if (this._gamePhase === 'PLACEMENT' && this._isDragging) {
      this._isDragging = false;
      if (this._controls) this._controls.enabled = true;
      // [AUDIO] Плавное затухание slide-звука (250ms)
      if (this._slideStopTimeout) clearTimeout(this._slideStopTimeout);
      audioManager.stopSlide(250);
      this._lastSlideX = null;
    } else if (this._gamePhase === 'AIMING' && this._isAiming) {
      this._isAiming = false;
      if (this._controls) this._controls.enabled = true;
      if (this.currentImpulse.lengthSq() > 0.00001) {
        if (this.onShoot) this.onShoot(this.currentImpulse.clone());
        this.currentImpulse.set(0, 0, 0);
      }
    }
  };

  _onKeyDown = (event) => {
    if (!this._isLocalPlayerActive()) return;
    if (event.code === 'Space') {
      event.preventDefault();
      const state = useGameStore.getState();
      if (this._gamePhase === 'PLACEMENT' && !state.isPlacementBlocked) {
        if (this.onConfirmPlacement) {
          this.onConfirmPlacement();
        }
      }
    }
  };

  _updateNDC(event) {
    const rect = this._canvas.getBoundingClientRect();
    this._pointerNDC.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    this._pointerNDC.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  validatePlacement(strikerX, strikerZ, physicsBodies, strikerEntry, strikerRadius, coinRadius) {
    // 1. Проверка коллизий с другими фишками
    const minDist = strikerRadius + coinRadius;
    for (const entry of physicsBodies) {
      if (entry === strikerEntry || !entry.body.isEnabled()) continue;
      const p = entry.body.translation();
      const dx = strikerX - p.x;
      const dz = strikerZ - p.z;
      if ((dx * dx + dz * dz) < (minDist * minDist)) {
        return false; // Есть коллизия с фишкой -> невалидно
      }
    }

    // 2. Проверка базовых кругов на концах базовой линии
    const minX = PLAYER_LINE_MIN_X;
    const maxX = PLAYER_LINE_MAX_X;

    const isAtMinCenter = Math.abs(strikerX - minX) < 0.001;
    const isAtMaxCenter = Math.abs(strikerX - maxX) < 0.001;

    const noTouchMinLimit = minX + coinRadius + strikerRadius;
    const noTouchMaxLimit = maxX - coinRadius - strikerRadius;
    const isInNoTouchZone = (strikerX >= noTouchMinLimit && strikerX <= noTouchMaxLimit);

    return (isAtMinCenter || isAtMaxCenter || isInNoTouchZone);
  }

  get isAiming()   { return this._isAiming; }
  get isDragging() { return this._isDragging; }
}
