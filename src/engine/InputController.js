/**
 * InputController.js
 * Обрабатывает все события указателя (мышь / тач).
 * Знает о Three.js (Raycaster), но не знает о React / физике.
 */

import * as THREE from 'three';
import { PHYSICS } from './PhysicsEngine.js';

export const PLAYER_1_LINE_Z  =  0.25;
export const PLAYER_2_LINE_Z  = -0.25;
export const PLAYER_LINE_MIN_X = -0.20;
export const PLAYER_LINE_MAX_X =  0.20;

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
    this.currentImpulse = new THREE.Vector3();
    this._aimStart = new THREE.Vector3();
    this._strikerEntry  = null;
    this._strikerSpawnY = 0;
    this._gamePhase = 'PLACEMENT';

    /** Коллбэки (устанавливает GameOrchestrator) */
    this.onStrikerDrag = null;
    this.onShoot = null;
  }

  attach(canvas, camera, controls) {
    this._canvas   = canvas;
    this._camera   = camera;
    this._controls = controls;
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup',   this._onUp);
  }

  detach() {
    if (!this._canvas) return;
    this._canvas.removeEventListener('pointerdown', this._onDown);
    this._canvas.removeEventListener('pointermove', this._onMove);
    this._canvas.removeEventListener('pointerup',   this._onUp);
  }

  setStrikerEntry(entry, strikerSpawnY) {
    this._strikerEntry  = entry;
    this._strikerSpawnY = strikerSpawnY;
  }

  setGamePhase(phase) { this._gamePhase = phase; }

  _onDown = (event) => {
    if (!this._strikerEntry) return;
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
    if (!this._strikerEntry) return;
    this._updateNDC(event);
    this._raycaster.setFromCamera(this._pointerNDC, this._camera);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._dragPlane, hit)) return;

    if (this._gamePhase === 'PLACEMENT' && this._isDragging) {
      const x = THREE.MathUtils.clamp(hit.x, PLAYER_LINE_MIN_X, PLAYER_LINE_MAX_X);
      if (this.onStrikerDrag) this.onStrikerDrag(x);
    } else if (this._gamePhase === 'AIMING' && this._isAiming) {
      const pull = new THREE.Vector3().subVectors(hit, this._aimStart);
      if (pull.length() > PHYSICS.maxPullDistance) pull.setLength(PHYSICS.maxPullDistance);
      this.currentImpulse.copy(pull).multiplyScalar(-1);
    }
  };

  _onUp = () => {
    if (this._gamePhase === 'PLACEMENT' && this._isDragging) {
      this._isDragging = false;
      if (this._controls) this._controls.enabled = true;
    } else if (this._gamePhase === 'AIMING' && this._isAiming) {
      this._isAiming = false;
      if (this._controls) this._controls.enabled = true;
      if (this.currentImpulse.lengthSq() > 0.00001) {
        if (this.onShoot) this.onShoot(this.currentImpulse.clone());
        this.currentImpulse.set(0, 0, 0);
      }
    }
  };

  _updateNDC(event) {
    const rect = this._canvas.getBoundingClientRect();
    this._pointerNDC.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    this._pointerNDC.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  checkPlacementOverlap(strikerX, strikerZ, physicsBodies, strikerEntry, strikerRadius, coinRadius) {
    const minDist = strikerRadius + coinRadius;
    for (const entry of physicsBodies) {
      if (entry === strikerEntry || !entry.body.isEnabled()) continue;
      const p = entry.body.translation();
      const dx = strikerX - p.x;
      const dz = strikerZ - p.z;
      if ((dx * dx + dz * dz) < (minDist * minDist)) return true;
    }
    return false;
  }

  get isAiming()   { return this._isAiming; }
  get isDragging() { return this._isDragging; }
}
