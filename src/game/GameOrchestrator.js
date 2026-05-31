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
import { audioManager } from '../engine/AudioManager.js';
import { AIBotManager } from '../engine/AIBotManager.js';
import { CHALLENGE_LEVELS } from '../config/levels.js';

export class GameOrchestrator {
  constructor() {
    this.physics = new PhysicsEngine();
    this.render  = new RenderCore();
    this.input   = new InputController();
    this.rules   = new GameRulesManager(this.physics, this.render, this.input);
    this.botManager = new AIBotManager(this);
    this._isStarted = false;

    /** THREE.Group для фишек пирамиды (кроме битка) — для визуального вращения */
    this.pyramidGroup = null;

    /** Массив цветов фишек (для рандом-режима и сетевой синхронизации) */
    this._coinColors = null;

    /** Отписка от pyramidRotation в Zustand */
    this._pyramidRotationUnsub = null;

    /** Отписка от pyramidStyle в Zustand */
    this._pyramidStyleUnsub = null;
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

    // 3. Аудио: инициализируем сразу после render.init() пока у нас есть
    //    camera и scene. preload() запускаем параллельно с loadModel —
    //    SFX успеют загрузиться к первому удару.
    audioManager.init(this.render.camera, this.render.scene);
    const audioPreloadPromise = audioManager.preload();

    // 4. Загружаем модель (параллельно с preload аудио)
    const model = await this.render.loadModel('/models/carrom-draco.glb');
    if (!model) return;

    // 5. Настраиваем физические тела
    this._setupPhysics(model);

    // Включаем тени для монет/битка (программно созданные меши)
    this.render.setupCoinShadows(this.physics.physicsBodies);

    // Дожидаемся завершения предзагрузки аудио
    await audioPreloadPromise;

    // 6. Прогрев физики (усадка фишек)
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
    this.physics.onOutOfBounds = (entry) => {
      this.rules.handleOutOfBounds(entry);
    };

    // 9. Подписка на pyramidRotation — вращаем группу локально
    this._pyramidRotationUnsub = useGameStore.subscribe(
      (state) => state.pyramidRotation,
      (rad) => {
        if (this.pyramidGroup && !useGameStore.getState().isPyramidLocked) {
          this.pyramidGroup.rotation.y = rad;
        }
      }
    );

    // 9.1. Подписка на Undo trigger (для training)
    this._undoUnsub = useGameStore.subscribe(
      (state) => state.undoTrigger,
      (trigger) => {
        if (trigger > 0) {
          const popped = useGameStore.getState().popHistory();
          if (popped && popped.snapshot) {
            this.physics.applySnapshot(popped.snapshot);
            this._syncAfterWarmup();
            // Возвращаем стейт в PLACEMENT, если мы откатились (или оставляем в AIMING?)
            // Обычно после Undo мы снова можем целиться (AIMING), но если биток был не заблокирован, то PLACEMENT.
            // Лучше перевести в AIMING, если биток на столе, или PLACEMENT. 
            // Пусть будет PLACEMENT, чтобы игрок мог переставить биток.
            this.input.setGamePhase('PLACEMENT');
            useGameStore.getState().setGamePhase('PLACEMENT');
            this.rules._isEvaluating = false;
            
            // Восстанавливаем биток как kinematic
            const strikerPos = this.rules.strikerEntry.mesh.position.clone();
            this.physics.makeStrikerKinematic(this.rules.strikerEntry, { x: strikerPos.x, y: strikerPos.y, z: strikerPos.z });
          }
        }
      }
    );

    // 9.5. Отправка SYNC_PYRAMID_LIVE для текущего активного игрока (20 FPS)
    this._lastSentPyramidRotation = null;
    this._liveSyncInterval = setInterval(() => {
      const state = useGameStore.getState();
      const isActivePlayer = state.networkMode !== 'local' && state.currentPlayer === state.localPlayerRole;
      
      if (isActivePlayer && !state.isPyramidLocked) {
        const rad = state.pyramidRotation;
        if (this._lastSentPyramidRotation !== rad) {
          networkManager.send('SYNC_PYRAMID_LIVE', { 
            rotation: rad,
            colors: this._coinColors
          });
          this._lastSentPyramidRotation = rad;
        }
      }
    }, 50);

    // 10. Обработка SYNC_PYRAMID (окончательное применение)
    networkManager.on('SYNC_PYRAMID', (data) => {
      const { networkMode } = useGameStore.getState();
      if (networkMode !== 'local') {
        this._applyPyramidData(data.rotation, data.colors, true);
        useGameStore.getState().lockPyramid();
        console.log('🌐 [Network] SYNC_PYRAMID получен, пирамида применена.');
      }
    });

    // 10.5. Обработка SYNC_PYRAMID_LIVE (живое вращение по сети)
    networkManager.on('SYNC_PYRAMID_LIVE', (data) => {
      const { networkMode } = useGameStore.getState();
      if (networkMode !== 'local') {
        this._applyPyramidData(data.rotation, data.colors, false);
      }
    });

    // 11. Подписка на изменение типа пирамиды (для немедленного применения из настроек)
    this._pyramidStyleUnsub = useGameStore.subscribe(
      (state) => state.settings.gameplay?.pyramidStyle,
      (style) => {
        if (!useGameStore.getState().isPyramidLocked && this.pyramidGroup) {
          this._applyPyramidStyle(style, true);
          const state = useGameStore.getState();
          if (state.networkMode === 'host') {
            networkManager.send('SYNC_PYRAMID_LIVE', { 
              rotation: state.pyramidRotation,
              colors: this._coinColors
            });
          }
        }
      }
    );

    // Сигнализируем React, что готово (теперь это делает MainMenu)
    // useGameStore.getState().setReady(true);

    // Стартовый голос воспроизводится ПОСЛЕ того, как игрок нажал кнопку в меню
    // (т.е. после setReady(true)). До этого AudioContext заблокирован политикой браузера.
    // Подписываемся на isReady: при первом переходе false → true вызываем startGame().
    this._startGameOnReady();

    // Начальная валидация позиции
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

  /**
   * Вызывает rules.startGame() как только isReady переходит в true.
   * Проверяем текущее значение сразу — подписка может пропустить уже
   * установленное значение если оно было true ещё до subscribe().
   */
  _startGameOnReady() {
    // Если isReady уже true к моменту вызова — запускаем сразу
    if (useGameStore.getState().isReady) {
      this._applyGameModeSetup();
      this.rules._lastCurrentPlayer = null;
      this.rules.startGame();
      return;
    }

    const unsub = useGameStore.subscribe(
      (state) => state.isReady,
      (isReady) => {
        if (!isReady) return;
        unsub();
        this._applyGameModeSetup();
        this.rules._lastCurrentPlayer = null;
        this.rules.startGame();
      }
    );
  }

  restartGame(startingPlayer = null) {
    // Сброс пирамиды: возвращаем группу в исходный поворот
    if (this.pyramidGroup) {
      this.pyramidGroup.rotation.y = 0;
    }

    if (this.initialSnapshot) {
      this.physics.applySnapshot(this.initialSnapshot);
      this._syncAfterWarmup();

      // Возвращаем фишки обратно в pyramidGroup для возможности вращения в новой игре
      if (this.pyramidGroup) {
        for (const entry of this.physics.physicsBodies) {
          const type = entry.mesh.userData.type;
          if (type === 'white' || type === 'black' || type === 'queen') {
            this.pyramidGroup.add(entry.mesh);
          }
        }
      }
    }
    
    this._coinColors = null;

    useGameStore.getState().initGame(startingPlayer);
    this._applyGameModeSetup();

    this.rules._lastCurrentPlayer = null;
    this.rules._isEvaluating = false;
    this.input.setGamePhase('PLACEMENT');
    this.rules._validateInitialPlacement(useGameStore.getState().currentPlayer);
    this.rules.startGame();
  }

  _applyGameModeSetup() {
    const gameMode = useGameStore.getState().gameMode;
    if (gameMode === 'challenge') {
      const levelId = useGameStore.getState().currentLevelId;
      const challengeLevel = CHALLENGE_LEVELS.find(l => l.id === levelId);
      
      let usedCoins = 0;
      for (const entry of this.physics.physicsBodies) {
        if (entry.mesh.userData.type === 'striker') continue;
        
        if (challengeLevel && usedCoins < challengeLevel.coins.length) {
          const coinData = challengeLevel.coins[usedCoins];
          const spawnPos = { x: coinData.x, y: 0.0081, z: coinData.z }; // boardTopY + coinHalfH
          
          entry.mesh.userData.type = coinData.color;
          this._setMeshColor(entry.mesh, coinData.color === 'white' ? PHYSICS.colorWhite : PHYSICS.colorBlack);
          
          entry.mesh.visible = true;
          entry.body.setTranslation(spawnPos, true);
          entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          entry.body.setEnabled(true);
          usedCoins++;
        } else {
          entry.mesh.visible = false;
          entry.body.setTranslation({ x: 0, y: -10, z: 0 }, true);
          entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          entry.body.setEnabled(false);
        }
      }
      this._syncAfterWarmup();
    } else {
      // Восстанавливаем видимость и физику
      for (const entry of this.physics.physicsBodies) {
        if (entry.mesh.userData.type === 'striker') continue;
        entry.mesh.visible = true;
        entry.body.setEnabled(true);
      }
      
      const style = useGameStore.getState().settings.gameplay?.pyramidStyle ?? 'classic';
      if (style === 'random') {
        const colorArr = Array(9).fill('white').concat(Array(9).fill('black'));
        for (let i = colorArr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [colorArr[i], colorArr[j]] = [colorArr[j], colorArr[i]];
        }
        this._coinColors = colorArr;
      }
      
      let groupIdx = 0;
      for (const entry of this.physics.physicsBodies) {
        if (entry.mesh.userData.type === 'striker') continue;
        if (entry.mesh.userData.type === 'queen') {
          this._setMeshColor(entry.mesh, PHYSICS.colorRed);
        } else {
          let isWhite;
          if (this._coinColors) {
            isWhite = this._coinColors[groupIdx] === 'white';
          } else {
            isWhite = (groupIdx + 1) % 2 === 0;
          }
          entry.mesh.userData.type = isWhite ? 'white' : 'black';
          this._setMeshColor(entry.mesh, isWhite ? PHYSICS.colorWhite : PHYSICS.colorBlack);
          groupIdx++;
        }
      }
    }
  }

  // ─── RAF-тик ────────────────────────────────────────────────────────────────

  _tick() {
    const phase = useGameStore.getState().gamePhase;

    // Физический шаг (только не в PLACEMENT)
    if (phase !== 'PLACEMENT') {
      this.physics.tick();
    }

    // Синхронизация мешей с физикой
    if (this.physics.isActive) {
      this.render.syncBodies(
        this.physics.physicsBodies,
        this.rules.strikerEntry,
        phase
      );
    }

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

      // ── Определяем цвета фишек (классика или рандом) ──────────────────────────
      const pyramidStyle = useGameStore.getState().settings?.gameplay?.pyramidStyle ?? 'classic';
      
      if (pyramidStyle === 'random') {
        const colorArr = Array(9).fill('white').concat(Array(9).fill('black'));
        for (let i = colorArr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [colorArr[i], colorArr[j]] = [colorArr[j], colorArr[i]];
        }
        this._coinColors = colorArr;
      } else {
        this._coinColors = null;
      }

      this.pyramidGroup = new THREE.Group();
      this.render.scene.add(this.pyramidGroup);

      for (let i = 0; i < 19; i++) {
        const clone = coinTemplate.clone();
        clone.visible = true;
        clone.userData.id = i;

        if (i === 0) {
          clone.userData.type = 'queen';
          this._setMeshColor(clone, PHYSICS.colorRed);
          this.pyramidGroup.add(clone);
        } else {
          let isWhite;
          if (this._coinColors) {
            isWhite = this._coinColors[i - 1] === 'white';
          } else {
            isWhite = i % 2 === 0;
          }
          clone.userData.type = isWhite ? 'white' : 'black';
          this._setMeshColor(clone, isWhite ? PHYSICS.colorWhite : PHYSICS.colorBlack);
          this.pyramidGroup.add(clone);
        }

        const spawnPos = perfectPos[i];
        spawnPos.y = boardTopY + coinHalfH;
        clone.position.set(spawnPos.x, spawnPos.y, spawnPos.z);

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

  /**
   * Вызывается из PyramidRotator при нажатии "Применить".
   * 1. Генерирует/читает цвета (для рандом-режима)
   * 2. «Запекает» текущий поворот группы в физические тела
   * 3. Отправляет SYNC_PYRAMID (только хост/local)
   * 4. Вызывает lockPyramid() в сторе
   */
  applyPyramidRotation() {
    const state = useGameStore.getState();
    const rotation = state.pyramidRotation;

    // Убедимся, что цвета сгенерированы/обновлены перед запеканием
    const style = state.settings.gameplay?.pyramidStyle ?? 'classic';
    this._applyPyramidStyle(style, false);
    
    const colors = this._coinColors; // null для классики

    // «Запекаем» трансформы группы в мировые координаты
    this._bakePyramidGroupToPhysics();

    // Отправляем SYNC_PYRAMID только если сетевая игра (host или client)
    if (state.networkMode !== 'local') {
      networkManager.send('SYNC_PYRAMID', { rotation, colors });
      console.log('🌐 [Network] SYNC_PYRAMID отправлен:', { rotation: rotation.toFixed(3), colors: colors ? 'random' : 'classic' });
    }

    // Блокируем пирамиду в сторе
    state.lockPyramid();
    console.log('🔒 Пирамида применена и заблокирована.');
  }

  /**
   * Применяет данные пирамиды, полученные по сети (SYNC_PYRAMID или SYNC_PYRAMID_LIVE).
   * Используется клиентом.
   * @param {number} rotation — угол в радианах
   * @param {string[]|null} colors — массив цветов ('white'|'black') для позиций 1-18
   * @param {boolean} bake — нужно ли запекать изменения в физику
   */
  _applyPyramidData(rotation, colors, bake = true) {
    // Применяем угол к группе
    if (this.pyramidGroup) {
      this.pyramidGroup.rotation.y = rotation;
      useGameStore.getState().setPyramidRotation(rotation);
    }

    // Применяем цвета если рандом
    if (colors && Array.isArray(colors)) {
      this._coinColors = colors;
      // Перекрашиваем меши
      let groupIdx = 0;
      for (const entry of this.physics.physicsBodies) {
        const type = entry.mesh.userData.type;
        if (type === 'white' || type === 'black') {
          const newColor = colors[groupIdx] ?? (groupIdx % 2 === 0 ? 'white' : 'black');
          entry.mesh.userData.type = newColor;
          this._setMeshColor(entry.mesh, newColor === 'white' ? PHYSICS.colorWhite : PHYSICS.colorBlack);
          groupIdx++;
        }
      }
    }

    // Запекаем в физику
    if (bake) {
      this._bakePyramidGroupToPhysics();
    }
  }

  /**
   * Генерирует и применяет стиль пирамиды (классика или рандом) к мешам.
   * Вызывается при создании пирамиды или изменении настроек до старта.
   */
  _applyPyramidStyle(style, forceRandomize = false) {
    if (!this.pyramidGroup) return;

    if (style === 'random') {
      if (!this._coinColors || forceRandomize) {
        const colorArr = Array(9).fill('white').concat(Array(9).fill('black'));
        for (let i = colorArr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [colorArr[i], colorArr[j]] = [colorArr[j], colorArr[i]];
        }
        this._coinColors = colorArr;
      }
    } else {
      this._coinColors = null;
    }

    let groupIdx = 0;
    for (const child of this.pyramidGroup.children) {
      if (child.userData.type === 'queen') continue;
      
      let isWhite;
      if (this._coinColors) {
        isWhite = this._coinColors[groupIdx] === 'white';
      } else {
        // ID 1-18. ID=1 (groupIdx=0) - черный, ID=2 (groupIdx=1) - белый.
        // Подождите, в _setupPhysics: i % 2 === 0 -> white. 
        // Если i начинается с 1 (так как i=0 это королева),
        // то i=1 (нечетное) -> black, i=2 (четное) -> white.
        isWhite = (groupIdx + 1) % 2 === 0;
      }
      child.userData.type = isWhite ? 'white' : 'black';
      this._setMeshColor(child, isWhite ? PHYSICS.colorWhite : PHYSICS.colorBlack);
      groupIdx++;
    }
  }



  /**
   * Запекает текущую трансформацию pyramidGroup в физические тела Rapier.
   * После этого группа сбрасывается в y=0, а меши переносятся в scene.
   */
  _bakePyramidGroupToPhysics() {
    if (!this.pyramidGroup) return;

    // Обновляем мировые матрицы
    this.pyramidGroup.updateMatrixWorld(true);

    const worldPos = new THREE.Vector3();
    const children = [...this.pyramidGroup.children];

    for (const child of children) {
      // Получаем мировую позицию
      child.getWorldPosition(worldPos);
      const worldQuat = child.getWorldQuaternion(new THREE.Quaternion());

      // Находим соответствующее физическое тело
      const entry = this.physics.physicsBodies.find(e => e.mesh === child);
      if (entry && entry.body) {
        // Обновляем позицию тела в Rapier
        const current = entry.body.translation();
        entry.body.setTranslation({ x: worldPos.x, y: current.y, z: worldPos.z }, false);
        entry.body.setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w }, false);
        entry.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        entry.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      }

      // Переносим меш из группы в сцену с сохранением мировых координат
      this.render.scene.attach(child);
    }

    // Сбрасываем поворот группы (она теперь пустая)
    this.pyramidGroup.rotation.y = 0;
    console.log(`🔄 Запечено ${children.length} фишек из pyramidGroup в физику.`);
  }

  dispose() {
    this.input.detach();
    this.rules.dispose();
    this.render.dispose();
    this.physics.dispose();
    audioManager.dispose();
    this.botManager.dispose();
    if (this._undoUnsub) {
      this._undoUnsub();
      this._undoUnsub = null;
    }
    if (this._pyramidRotationUnsub) {
      this._pyramidRotationUnsub();
      this._pyramidRotationUnsub = null;
    }
    if (this._pyramidStyleUnsub) {
      this._pyramidStyleUnsub();
      this._pyramidStyleUnsub = null;
    }
    if (this._liveSyncInterval) {
      clearInterval(this._liveSyncInterval);
      this._liveSyncInterval = null;
    }
    this._isStarted = false;
  }
}

// Singleton — единственный экземпляр за сессию
export const orchestrator = new GameOrchestrator();
