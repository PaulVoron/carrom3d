/**
 * GameOrchestrator.js
 * Связывает PhysicsEngine, RenderCore, InputController и GameRulesManager.
 * Запускается единожды из GameCanvas.jsx при монтировании canvas.
 * Является "главным" модулем, который знает обо всех движках.
 */

import * as THREE from 'three';
import { PhysicsEngine, PHYSICS } from '../engine/PhysicsEngine.js';
import { RenderCore } from '../engine/RenderCore.js';
import { InputController, PLAYER_1_LINE_Z } from '../engine/InputController.js';
import { GameRulesManager } from '../engine/GameRulesManager.js';
import { useGameStore } from '../store/useGameStore.js';
import { DEBUG_MODE } from '../engine/3d-scene-settings.js';
import { networkManager } from '../engine/NetworkManager.js';

export class GameOrchestrator {
  constructor() {
    this.physics = new PhysicsEngine();
    this.render  = new RenderCore();
    this.input   = new InputController();
    this.rules   = new GameRulesManager(this.physics, this.render, this.input);
    this._isStarted = false;
  }

  /**
   * Точка входа. Вызывается из GameCanvas.jsx с ref на canvas.
   * @param {HTMLCanvasElement} canvas
   */
  async start(canvas) {
    if (this._isStarted) return;
    this._isStarted = true;

    // 1. Физика
    await this.physics.init();

    // 2. Рендер (передаём onTick)
    this.render.init(canvas, () => this._tick());

    // 3. Загружаем модель
    const model = await this.render.loadModel('/models/carrom-draco.glb');
    if (!model) return;

    // 4. Настраиваем физические тела
    this._setupPhysics(model);

    // 5. Прогрев физики (усадка фишек)
    this.physics.warmup(240);
    this._syncAfterWarmup();
    this.initialSnapshot = this.physics.getSnapshot();

    // 6. Привязываем инпут
    this.input.attach(canvas, this.render.camera, this.render.controls);
    this.input.setStrikerEntry(this.rules.strikerEntry, this.rules.strikerSpawnY);
    this.input.setGamePhase('PLACEMENT');

    // 7. Коллбэки инпута → движок правил
    this.input.onStrikerDrag = (x) => {
      const player = useGameStore.getState().currentPlayer;
      this.rules.onStrikerDrag(x, player);
    };
    this.input.onShoot = (impulse) => {
      this.rules.shoot(impulse);
    };
    this.input.onConfirmPlacement = () => {
      this.confirmPlacement();
    };

    // 8. Коллбэк лузы → правила
    this.physics.onPocketEnter = (entry) => {
      this.rules.handlePocketResult(entry);
    };

    // 9. Сигнализируем React, что готово (теперь это делает MainMenu)
    // useGameStore.getState().setReady(true);

    // 10. Начальная валидация позиции
    this.rules._validateInitialPlacement(1);

    networkManager.on('RESTART_GAME', (data) => {
      if (useGameStore.getState().networkMode === 'client') {
        this.restartGame(data.startingPlayer);
      }
    });
    
    networkManager.on('RESTART_REQUEST', () => {
      if (useGameStore.getState().networkMode === 'host') {
        const nextStarter = useGameStore.getState().lastStartingPlayer === 1 ? 2 : 1; 
        networkManager.send('RESTART_GAME', { startingPlayer: nextStarter });
        this.restartGame(nextStarter);
      }
    });
  }

  restartGame(startingPlayer = null) {
    if (this.initialSnapshot) {
      this.physics.applySnapshot(this.initialSnapshot);
      this._syncAfterWarmup();
    }
    useGameStore.getState().initGame(startingPlayer);
    this.input.setGamePhase('PLACEMENT');
    this.rules._validateInitialPlacement(useGameStore.getState().currentPlayer);
  }

  // ─── RAF-тик ────────────────────────────────────────────────────────────────

  _tick() {
    const phase = useGameStore.getState().gamePhase;

    // Физический шаг (только не в PLACEMENT)
    if (phase !== 'PLACEMENT') {
      const steps = this.physics.tick();
      if (steps > 0) {
        this.physics.checkPockets();
      }
    }

    // Синхронизация мешей с физикой
    this.render.syncBodies(
      this.physics.physicsBodies,
      this.rules.strikerEntry,
      phase
    );

    // Логика правил (визуал прицеливания + проверка сна)
    this.rules.tick();
  }

  // ─── Настройка физики ────────────────────────────────────────────────────────

  _setupPhysics(model) {
    const positions = new Array(19).fill(null);
    let strikerMesh = null;
    let coinTemplate = null;
    
    const boardTopY = 0.001;

    model.updateMatrixWorld(true);

    model.traverse((obj) => {
      if (obj.name === 'mesh_board_surface') {
        const bbox = new THREE.Box3().setFromObject(obj);
        const boardGeom = {
          minX: bbox.min.x, maxX: bbox.max.x,
          minZ: bbox.min.z, maxZ: bbox.max.z,
          cx: (bbox.min.x + bbox.max.x) / 2,
          cz: (bbox.min.z + bbox.max.z) / 2,
          widthX: bbox.max.x - bbox.min.x,
          widthZ: bbox.max.z - bbox.min.z,
        };
        this.physics.createBoardBodies(boardGeom);

        if (DEBUG_MODE) {
          const drawDebugBox = (w, h, d, x, y, z, color) => {
            const geo = new THREE.BoxGeometry(w, h, d);
            const mat = new THREE.MeshBasicMaterial({
              color: color,
              wireframe: true,
              transparent: true,
              opacity: 0.3
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, z);
            this.render.scene.add(mesh);
          };

          const drawDebugCylinder = (radius, height, x, y, z, color) => {
            const geo = new THREE.CylinderGeometry(radius, radius, height, 32);
            const mat = new THREE.MeshBasicMaterial({
              color: color,
              wireframe: true,
              transparent: true,
              opacity: 0.6
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, z);
            this.render.scene.add(mesh);
          };

          const floorHalfH = 0.05;
          const floorCenterY = boardTopY - floorHalfH;
          const wt = 0.1;
          const wh = 0.40;
          const wy = floorCenterY + (floorHalfH - 0.05);
          const roofHeight = 0.25;

          // 1. Пол
          drawDebugBox(boardGeom.widthX, floorHalfH * 2, boardGeom.widthZ, boardGeom.cx, floorCenterY, boardGeom.cz, 0x0088ff);

          // 2. Борта
          drawDebugBox(boardGeom.widthX + wt * 2, wh * 2, wt, boardGeom.cx, wy, boardGeom.minZ - wt / 2, 0xff0000);
          drawDebugBox(boardGeom.widthX + wt * 2, wh * 2, wt, boardGeom.cx, wy, boardGeom.maxZ + wt / 2, 0xff0000);
          drawDebugBox(wt, wh * 2, boardGeom.widthZ + wt * 2, boardGeom.minX - wt / 2, wy, boardGeom.cz, 0xff0000);
          drawDebugBox(wt, wh * 2, boardGeom.widthZ + wt * 2, boardGeom.maxX + wt / 2, wy, boardGeom.cz, 0xff0000);

          // 3. Зеленая крышка
          drawDebugBox(1.0, 0.02, 1.0, 0, roofHeight, 0, 0x00ff00);

          // 4. Лузы
          const triggerRadius = PHYSICS.pocketRadius;
          this.physics.pocketCenters.forEach((pos) => {
            drawDebugCylinder(triggerRadius, 0.1, pos.x, boardTopY, pos.z, 0xff00ff);
          });
        }
      }
      if (obj.name === 'mesh_carrom_man') { coinTemplate = obj; obj.visible = false; }
      if (obj.name.startsWith('pos_coin_')) {
        const i = parseInt(obj.name.replace('pos_coin_', ''));
        positions[i] = obj.getWorldPosition(new THREE.Vector3());
        obj.visible = false;
      }
      if (obj.name === 'mesh_striker') { strikerMesh = obj; }
    });

    // ── Фишки ────────────────────────────────────────────────────────────
    const coinDia   = PHYSICS.coinDia;
    const coinHalfH = PHYSICS.coinHeight / 2;

    if (coinTemplate) {
      this.render.scene.add(coinTemplate);
      coinTemplate.scale.set(1, 1, 1);
      coinTemplate.updateMatrixWorld(true);

      const bbox = new THREE.Box3().setFromObject(coinTemplate);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      coinTemplate.scale.set(coinDia / size.x, (coinHalfH * 2) / size.y, coinDia / size.z);
      coinTemplate.updateMatrixWorld(true);

      const boardCenter = positions[0]
        ? positions[0].clone()
        : new THREE.Vector3(0, boardTopY, 0);
      boardCenter.y = boardTopY;

      const perfectPos = this._getCarromPositions(boardCenter, coinDia, -Math.PI / 4);
      const coinRadius = coinDia / 2;

      for (let i = 0; i < 19; i++) {
        const clone = coinTemplate.clone();
        clone.visible = true;
        this.render.scene.add(clone);
        clone.userData.id = i;

        if (i === 0) {
          clone.userData.type = 'queen';
          this._setMeshColor(clone, PHYSICS.colorRed);
        } else {
          const isWhite = i % 2 === 0;
          clone.userData.type = isWhite ? 'white' : 'black';
          this._setMeshColor(clone, isWhite ? PHYSICS.colorWhite : PHYSICS.colorBlack);
        }

        const spawnPos = perfectPos[i];
        spawnPos.y = boardTopY + coinHalfH + 0.000;

        const body = this.physics.createDynamicBody(coinRadius, coinHalfH, spawnPos);
        this.physics.physicsBodies.push({ mesh: clone, body });
      }

      this.rules.coinRadius = coinRadius;
    }

    // ── Биток ────────────────────────────────────────────────────────────
    if (strikerMesh) {
      const strikerDia   = PHYSICS.strikerDia;
      const strikerHalfH = PHYSICS.strikerHeight / 2;

      this.render.scene.add(strikerMesh);
      strikerMesh.scale.set(1, 1, 1);
      strikerMesh.updateMatrixWorld(true);

      const bbox = new THREE.Box3().setFromObject(strikerMesh);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      strikerMesh.scale.set(strikerDia / size.x, (strikerHalfH * 2) / size.y, strikerDia / size.z);
      strikerMesh.updateMatrixWorld(true);

      strikerMesh.userData.id   = 999;
      strikerMesh.userData.type = 'striker';

      const spawnY   = boardTopY + strikerHalfH;
      const spawnPos = { x: 0, y: spawnY, z: PLAYER_1_LINE_Z };
      const body = this.physics.createKinematicBody(strikerDia / 2, strikerHalfH, spawnPos);

      strikerMesh.position.copy(new THREE.Vector3(spawnPos.x, spawnPos.y, spawnPos.z));

      const strikerEntry = { mesh: strikerMesh, body };
      this.physics.physicsBodies.push(strikerEntry);

      this.rules.setStrikerData(strikerEntry, spawnY, strikerDia / 2, this.rules.coinRadius);
    }
  }

  _syncAfterWarmup() {
    for (const { mesh, body } of this.physics.physicsBodies) {
      if (body.isEnabled()) {
        const p = body.translation();
        const r = body.rotation();
        mesh.position.set(p.x, p.y, p.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    if (this.rules.strikerEntry) {
      this.rules.strikerSpawnY = this.rules.strikerEntry.body.translation().y;
    }
  }

  // ─── Утилиты ────────────────────────────────────────────────────────────────

  _setMeshColor(obj, color) {
    obj.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.color.set(color);
      }
    });
  }

  _getCarromPositions(center, diameter, rotation = 0) {
    const gap = 0.0002;
    const d   = diameter + gap;
    const pos = [];

    pos.push(new THREE.Vector3(center.x, center.y, center.z));

    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + rotation;
      pos.push(new THREE.Vector3(center.x + Math.cos(a) * d, center.y, center.z + Math.sin(a) * d));
    }

    const dSq3 = d * Math.sqrt(3);
    for (let i = 0; i < 12; i++) {
      const a    = (i * Math.PI) / 6 + rotation;
      const dist = i % 2 === 0 ? 2 * d : dSq3;
      pos.push(new THREE.Vector3(center.x + Math.cos(a) * dist, center.y, center.z + Math.sin(a) * dist));
    }

    return pos;
  }

  /** Вызывается из ConfirmButton.jsx */
  confirmPlacement() {
    this.rules.confirmPlacement();
  }

  dispose() {
    this.input.detach();
    this.render.dispose();
    this.physics.dispose();
    this._isStarted = false;
  }
}

// Singleton — единственный экземпляр за сессию
export const orchestrator = new GameOrchestrator();
