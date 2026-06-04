/**
 * RenderCore.js
 * Обёртка над Three.js. Не знает о React и физике.
 * Получает коллбэк onTick, вызывающийся каждый кадр перед рендером.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as dat from 'dat.gui';
import gsap from 'gsap';

import {
  TONE_MAPPING_EXPOSURE,
  BACKGROUND_COLOR,
  ENVIRONMENT_MAP,
  ENVIRONMENT_MAP_INTENSITY,
  ENVIRONMENT_MAP_ANGLE,
  ENVIRONMENT_MAP_FLIP_X,
  ENVIRONMENT_MAP_ROTATEBLE,
  START_CAMERA_POSITION,
  CONTROL_TARGET_POSITION_Y,
  CONTROLS_ENABLE_PAN,
  CONTROLS_FIX_VERTICAL_PAN,
  DEV_MODE_HELPERS,
  ADD_DIRLIGHT,
  DIRLIGHT_INTENSITY,
  ADD_POINTLIGHT,
  POINTLIGHT_INTENSITY,
  ADD_AMBIENTLIGHT,
  AMBIENTLIGHT_INTENSITY,
  ADD_FLOOR,
  SHADOW_TRANSPARENCY,
  RENDER_SCALE,
  MODEL_CENTER_POSITION,
  GUI_MODE_LIGHTING,
} from './3d-scene-settings.js';

import { useGameStore } from '../store/useGameStore.js';

const isNewThreeJs = parseInt(THREE.REVISION) >= 150;

// ─── Палитры цветов фишек ─────────────────────────────────────────────────────

/** @type {Record<string, {white: number|string, black: number|string}>} */
const COIN_COLOR_PALETTES = {
  default: { white: 0xf5f0e8, black: 0x1a1a1a },   // классика: слоновая кость / почти чёрный
  golden:  { white: 0xffd700, black: 0xc0c0c0 },   // золото / серебро
  classic: { white: 0xd4b483, black: 0x6b3a2a },   // бежевый / коричневый (натуральный кэррам)
};

// ─── Проверка производительности ─────────────────────────────────────────────

function isWeakDevice() {
  if (navigator.hardwareConcurrency < 4) return true;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      if (!/Intel/i.test(r)) return false;
      if (/Iris\s?Xe/i.test(r) || /Arc/i.test(r)) return false;
      if (/HD\s?Graphics/i.test(r) || /UHD\s?Graphics\s?6/i.test(r)) return true;
    }
  } catch (e) { return false; }
  return false;
}

// ─── RenderCore ───────────────────────────────────────────────────────────────

export class RenderCore {
  constructor() {
    /** @type {THREE.Scene} */       this.scene = null;
    /** @type {THREE.PerspectiveCamera} */ this.camera = null;
    /** @type {THREE.WebGLRenderer} */ this.renderer = null;
    /** @type {OrbitControls} */     this.controls = null;
    /** @type {THREE.DirectionalLight} */ this.dirLight = null;

    this._isLowPerf = isWeakDevice();
    this._envMap = null;
    this._currentEnvPath = ENVIRONMENT_MAP;
    this._initialLightOffset = new THREE.Vector3();
    this._animFrameId = null;

    /** @type {Function | null} Отписка от Zustand (скины) */
    this._skinsUnsub = null;

    // Предзагрузчик текстур (shared, чтобы не создавать новый при каждой загрузке)
    this._textureLoader = new THREE.TextureLoader();
  }

  // ─── Инициализация ──────────────────────────────────────────────────────────

  /**
   * Инициализировать Three.js сцену.
   * @param {HTMLCanvasElement} canvas
   * @param {Function} onTick — вызывается каждый кадр перед renderer.render()
   */
  init(canvas, onTick) {
    this._canvas = canvas;
    this._onTick = onTick;

    this._initScene();
    this._initCamera();
    this._initRenderer(canvas);
    this._initControls(canvas);
    this._initLights();
    if (ADD_FLOOR) this._initFloor();
    this._initEnvMap();
    if (GUI_MODE_LIGHTING) this._initGuiMode();
    this._startLoop();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND_COLOR || 0xffffff);
    if (DEV_MODE_HELPERS) {
      this.scene.add(new THREE.AxesHelper(10));
    }

    // Создаем прогрессивный треугольник прицеливания (BufferGeometry) красного цвета
    const group = new THREE.Group();
    const vertices = new Float32Array([
      -0.5, 0.0, 0.0, // Левый нижний угол (основание)
      0.5, 0.0, 0.0, // Правый нижний угол (основание)
      0.0, -1.0, 0.0  // Верхний угол (острие)
    ]);
    const uvs = new Float32Array([
      0.0, 0.0,
      1.0, 0.0,
      0.5, 1.0
    ]);
    const barGeo = new THREE.BufferGeometry();
    barGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    barGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    barGeo.computeVertexNormals();

    const barMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.2, // Еще прозрачнее (было 0.6)
      side: THREE.DoubleSide
    });
    const barMesh = new THREE.Mesh(barGeo, barMat);
    barMesh.rotation.x = -Math.PI / 2; // кладем на стол
    group.add(barMesh);

    this.aimBar = group;
    this.aimBarMesh = barMesh;
    this.aimBar.visible = false;
    this.scene.add(this.aimBar);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(...START_CAMERA_POSITION);
  }

  _initRenderer(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const maxPR = this._isLowPerf ? 1.5 : 2;
    const pr = Math.min(window.devicePixelRatio || 1, maxPR);
    const rs = this._isLowPerf ? 0.9 : RENDER_SCALE;
    this.renderer.setPixelRatio(pr * rs);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

    if (isNewThreeJs) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else {
      this.renderer.outputEncoding = 3001; // THREE.sRGBEncoding
    }
  }

  _initControls(canvas) {
    this.controls = new OrbitControls(this.camera, canvas);

    // ── Лимиты камеры ───────────────────────────────────────────────
    // Не опускаться ниже горизонта (0.1 рад ≈ 5.7° запас)
    this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
    // Исходные лимиты будут установлены при первой смене игрока
    // Дистанция: 0.3 = детально, 2.5 = весь стол виден
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 2.5;

    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.25;
    this.controls.enablePan = CONTROLS_ENABLE_PAN;
    this.controls.enableZoom = true;
    this.controls.target.set(0, CONTROL_TARGET_POSITION_Y, 0);

    this.controls.addEventListener('change', () => {
      if (CONTROLS_FIX_VERTICAL_PAN) {
        this.controls.target.y = CONTROL_TARGET_POSITION_Y;
      }
    });
  }

  _initLights() {
    if (ADD_AMBIENTLIGHT) {
      const amb = new THREE.AmbientLight(0x404040, AMBIENTLIGHT_INTENSITY);
      this.scene.add(amb);
    }

    if (ADD_DIRLIGHT) {
      this.dirLight = new THREE.DirectionalLight(0xffffff, DIRLIGHT_INTENSITY);
      this.dirLight.position.set(0, 12, 0.000001);
      this.dirLight.castShadow = true;
      // ── Shadow bias: меньше абсолютное значение = меньше peter-panning ──
      this.dirLight.shadow.bias = -0.0005;
      // normalBias: предотвращает shadow acne на поверхности фишек
      this.dirLight.shadow.normalBias = 0.02;
      const size = 3;
      this.dirLight.shadow.camera.left = -size;
      this.dirLight.shadow.camera.right = size;
      this.dirLight.shadow.camera.top = size;
      this.dirLight.shadow.camera.bottom = -size;
      this.dirLight.shadow.camera.near = 0.5;
      this.dirLight.shadow.camera.far = 50;
      // 4096 даёт чёткие тени для малых фишек; на мобильных — 1024 (сбережём GPU)
      const shadowSize = this._isLowPerf ? 1024 : 4096;
      this.dirLight.shadow.mapSize.set(shadowSize, shadowSize);
      // radius + blurSamples: значения для PCFSoftShadowMap
      this.dirLight.shadow.radius = this._isLowPerf ? 4 : 8;
      this.dirLight.shadow.blurSamples = this._isLowPerf ? 8 : 16;
      this._initialLightOffset.subVectors(this.dirLight.position, this.dirLight.target.position);
      this.scene.add(this.dirLight);
      this.scene.add(this.dirLight.target);
    }

    if (ADD_POINTLIGHT) {
      const pl = new THREE.PointLight(0xfff4e6, POINTLIGHT_INTENSITY, 3, 0);
      pl.position.set(2, MODEL_CENTER_POSITION + 1.8, 0);
      this.scene.add(pl);
    }
  }

  _initFloor() {
    const geo = new THREE.PlaneGeometry(5000, 5000);
    const mat = new THREE.ShadowMaterial({ opacity: SHADOW_TRANSPARENCY });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = -0.75;
    floor.frustumCulled = false;
    this.scene.add(floor);
  }

  _initEnvMap() {
    if (ENVIRONMENT_MAP && ENVIRONMENT_MAP !== '') {
      this._loadEnvMap(ENVIRONMENT_MAP, ENVIRONMENT_MAP_INTENSITY, ENVIRONMENT_MAP_ANGLE, ENVIRONMENT_MAP_FLIP_X);
    } else {
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 1.2));
    }
  }

  _loadEnvMap(path, intensity, angle = ENVIRONMENT_MAP_ANGLE, flipX = ENVIRONMENT_MAP_FLIP_X) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    new RGBELoader().load(path, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;

      if (ENVIRONMENT_MAP_ROTATEBLE) {
        const tmpScene = new THREE.Scene();
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(1, 32, 32),
          new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
        );
        sphere.scale.x = flipX ? 1 : -1;
        sphere.rotation.y = THREE.MathUtils.degToRad(180 - angle);
        tmpScene.add(sphere);
        this._envMap = pmrem.fromScene(tmpScene).texture;
      } else {
        this._envMap = pmrem.fromEquirectangular(texture).texture;
      }

      this.scene.environment = this._envMap;
      if (isNewThreeJs) this.scene.environmentIntensity = intensity;

      texture.dispose();
      pmrem.dispose();
    }, undefined, () => {
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
    });
  }

  // ─── RAF Loop ────────────────────────────────────────────────────────────────

  _startLoop() {
    const interval = this._isLowPerf ? 1000 / 30 : 1000 / 60;
    let last = performance.now();

    const animate = (time) => {
      this._animFrameId = requestAnimationFrame(animate);
      if (document.hidden) return;

      if (this._onTick) this._onTick();

      this.controls.update();

      const delta = time - last;
      if (delta >= interval) {
        last = time - (delta % interval);
        this.renderer.render(this.scene, this.camera);
      }
    };

    this._animFrameId = requestAnimationFrame(animate);
  }

  _onResize() {
    if (!this.renderer || !this._canvas) return;
    const rect = this._canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);

    if (this.renderer.domElement.width !== w || this.renderer.domElement.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  // ─── Загрузка моделей ────────────────────────────────────────────────────────

  /**
   * Загрузить GLB/GLTF модель.
   * @param {string} url
   * @param {boolean} addToScene
   * @returns {Promise<THREE.Group>}
   */
  async loadModel(url, addToScene = true) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      model.animations = gltf.animations;
      this._processModel(model);
      if (addToScene) this.scene.add(model);
      return model;
    } catch (err) {
      console.error(`[RenderCore] Failed to load model ${url}:`, err);
      return null;
    }
  }

  _processModel(model) {
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;

        if (o.geometry.attributes.uv && !o.geometry.attributes.uv2) {
          o.geometry.setAttribute('uv2', o.geometry.attributes.uv);
        }

        if (o.material.map) {
          o.material.map.anisotropy = this._isLowPerf ? 4 : 16;
          if (isNewThreeJs) o.material.map.colorSpace = THREE.SRGBColorSpace;
          else o.material.map.encoding = 3001; // THREE.sRGBEncoding
          o.material.map.needsUpdate = true;
          o.material.needsUpdate = true;
        }

        if (ENVIRONMENT_MAP !== '' && !isNewThreeJs && this._envMap) {
          o.material.envMap = this._envMap;
          o.material.envMapIntensity = ENVIRONMENT_MAP_INTENSITY;
          o.material.needsUpdate = true;
        }

        
        // if (o.material && o.material.name === 'board_surface') {
        //   o.material.metalness = 1;
        //   o.material.roughness = 0;
        // }
      }
    });


    model.scale.set(1, 1, 1);
    model.position.y = MODEL_CENTER_POSITION;
    model.updateMatrixWorld(true);

    this._updateShadowCamera([model]);
  }

  _updateShadowCamera(objects) {
    if (!this.dirLight) return;
    const bbox = new THREE.Box3();
    objects.forEach(o => { if (o) bbox.expandByObject(o); });
    if (bbox.isEmpty()) return;

    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());

    this.dirLight.target.position.copy(center);
    this.dirLight.target.updateMatrixWorld();
    this.dirLight.position.copy(center).add(this._initialLightOffset);

    // Тайтеним фрустум до размера стола (×1.1 — 5% запас)
    // Чем теснее frustum, тем выше плотность текселей на mapSize → чёткие тени фишек
    const cs = Math.max(size.x, size.z) / 2 * 1.1;
    this.dirLight.shadow.camera.left = -cs;
    this.dirLight.shadow.camera.right = cs;
    this.dirLight.shadow.camera.top = cs;
    this.dirLight.shadow.camera.bottom = -cs;
    this.dirLight.shadow.camera.updateProjectionMatrix();
  }

  // ─── Синхронизация физических тел с мешами ──────────────────────────────────

  /**
   * Копировать позиции из физических тел в THREE.js меши.
   * @param {Array<{mesh, body}>} entries
   * @param {{mesh, body} | null} strikerEntry — биток пропускается в PLACEMENT
   * @param {string} gamePhase
   */
  syncBodies(entries, strikerEntry, gamePhase) {
    for (const entry of entries) {
      const { mesh, body } = entry;

      if (gamePhase === 'PLACEMENT' && entry === strikerEntry) continue;

      if (body.isEnabled()) {
        const p = body.translation();
        const r = body.rotation();
        mesh.position.set(p.x, p.y, p.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  // ─── Утилиты для фишек и теней ───────────────────────────────────────────────

  /**
   * Включить отбрасывание / получение теней для программно созданных мешей фишек/битка.
   * Вызывать после создания всех физических тел.
   * @param {Array<{mesh: THREE.Object3D}>} entries
   */
  setupCoinShadows(entries) {
    for (const { mesh } of entries) {
      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow    = true;
          child.receiveShadow = true;
        }
      });
    }
  }

  /**
   * Установить ограничения угла камеры для текущего игрока.
   * @param {number} player 1 или 2
   */
  setCameraAzimuthLimits(player) {
    if (!this.controls) return;
    const range = Math.PI * 2 / 9; // ±40°
    const baseAngle = player === 1 ? 0 : Math.PI;
    this.controls.minAzimuthAngle = baseAngle - range;
    this.controls.maxAzimuthAngle = baseAngle + range;
  }

  /**
   * Кинематическая анимация камеры при Game Over.
   * Камера плавно поднимается в зенит (Top-Down вид над центром стола).
   * OrbitControls блокируются на время анимации.
   * @param {Function} onComplete — вызывается после завершения (~2 с)
   */
  animateCameraGameOver(onComplete) {
    const { camera, controls } = this;
    if (!camera || !controls) { onComplete?.(); return; }

    // Блокируем управление камерой
    controls.enabled = false;
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;

    // Целевая позиция: прямо над центром стола
    // Высота подбирается так, чтобы стол (≈ 0.6 м) умещался в кадр при FOV 35°
    const targetY    = 1.2;
    const targetPos  = { x: 0, y: targetY, z: 0.001 };
    const targetLook = { x: 0, y: 0, z: 0 };

    // Анимируем position камеры (gsap уже импортирован статически в этом файле)
    gsap.to(camera.position, {
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z,
      duration: 2.0,
      ease: 'power2.inOut',
      onUpdate: () => controls.update(),
      onComplete: () => {
        controls.target.set(0, 0, 0);
        controls.update();
        onComplete?.();
      },
    });

    // Плавно двигаем target к центру
    gsap.to(controls.target, {
      x: targetLook.x,
      y: targetLook.y,
      z: targetLook.z,
      duration: 2.0,
      ease: 'power2.inOut',
      onUpdate: () => controls.update(),
    });
  }

  dispose() {
    if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
    if (this._skinsUnsub) { this._skinsUnsub(); this._skinsUnsub = null; }
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
    if (this.aimBarMesh) {
      this.aimBarMesh.geometry.dispose();
      this.aimBarMesh.material.dispose();
    }
    this.renderer?.dispose();
    this.controls?.dispose();
  }

  // ─── Динамическая подмена скинов ────────────────────────────────────────────────────────────

  /**
   * Подписывается на изменения скинов в сторе и динамически обновляет текстуры.
   *
   * Загрузка — асинхронная: не блокирует RAF и не вызывает фризов физики.
   * После загрузки вызывается material.needsUpdate = true — рендерер сам подхватит в следующем кадре.
   *
   * @param {object} meshRefs — ссылки на меши, предоставляемые изнаружи (после загрузки моделей).
   *   boardMesh    {THREE.Mesh | null}   — игровая поверхность стола
   *   frameMeshes  {THREE.Mesh[]}        — меши деревянных бортов
   *   strikerMesh  {THREE.Mesh | null}   — топ битка
   *   whiteCoinMeshes {THREE.Mesh[]}     — белые фишки
   *   blackCoinMeshes {THREE.Mesh[]}     — чёрные фишки
   */
  initSkinsSubscription(meshRefs = {}) {
    this._meshRefs = meshRefs;

    // Немедленно применяем текущие настройки
    const initSkins = useGameStore.getState().settings.skins;
    this._applySkinsPartial(initSkins, {});

    // Подписываемся: при изменении обновляем только изменившиеся ключи
    let prevSkins = { ...initSkins };
    this._skinsUnsub = useGameStore.subscribe(
      (state) => state.settings.skins,
      (skins) => {
        this._applySkinsPartial(skins, prevSkins);
        prevSkins = { ...skins };
      },
      {
        equalityFn: (a, b) =>
          a.boardTexture   === b.boardTexture   &&
          a.frameTexture   === b.frameTexture   &&
          a.strikerTexture === b.strikerTexture &&
          a.coinColorSet   === b.coinColorSet   &&
          a.environmentMap === b.environmentMap,
      }
    );
  }

  /**
   * @private
   * Применяет изменения скинов. Загрузка текстур — асинхронная.
   */
  _applySkinsPartial(skins, prevSkins) {
    const { boardMesh, frameMeshes = [], strikerMesh, whiteCoinMeshes = [], blackCoinMeshes = [] } = this._meshRefs ?? {};

    // ─ boardTexture ────────────────────────────────────────────────────────────
    if (skins.boardTexture !== prevSkins.boardTexture && boardMesh) {
      this._textureLoader.load(skins.boardTexture, (tex) => {
        if (!boardMesh.material) return;
        this._configTexture(tex);
        boardMesh.material.map = tex;
        boardMesh.material.needsUpdate = true;
      });
    }

    // ─ frameTexture ───────────────────────────────────────────────────────────
    if (skins.frameTexture !== prevSkins.frameTexture && frameMeshes.length) {
      this._textureLoader.load(skins.frameTexture, (tex) => {
        this._configTexture(tex);
        frameMeshes.forEach((m) => {
          if (!m?.material) return;
          m.material.map = tex;
          m.material.needsUpdate = true;
        });
      });
    }

    // ─ strikerTexture ─────────────────────────────────────────────────────────
    if (skins.strikerTexture !== prevSkins.strikerTexture && strikerMesh) {
      this._textureLoader.load(skins.strikerTexture, (tex) => {
        if (!strikerMesh.material) return;
        this._configTexture(tex);
        strikerMesh.material.map = tex;
        strikerMesh.material.needsUpdate = true;
      });
    }

    // ─ coinColorSet ──────────────────────────────────────────────────────────
    if (skins.coinColorSet !== prevSkins.coinColorSet) {
      const palette = COIN_COLOR_PALETTES[skins.coinColorSet] ?? COIN_COLOR_PALETTES.default;
      whiteCoinMeshes.forEach((m) => {
        if (!m?.material) return;
        m.material.color.set(palette.white);
        m.material.needsUpdate = true;
      });
      blackCoinMeshes.forEach((m) => {
        if (!m?.material) return;
        m.material.color.set(palette.black);
        m.material.needsUpdate = true;
      });
    }

    // ─ environmentMap ───────────────────────────────────────────────────────
    if (skins.environmentMap !== prevSkins.environmentMap) {
      this._currentEnvPath = skins.environmentMap;
      this._loadEnvMap(skins.environmentMap, ENVIRONMENT_MAP_INTENSITY);
    }
  }

  /**
   * @private
   * Настраивает загруженную текстуру: colorSpace + anisotropy.
   * @param {THREE.Texture} tex
   */
  _configTexture(tex) {
    tex.anisotropy = this._isLowPerf ? 4 : 16;
    if (isNewThreeJs) tex.colorSpace = THREE.SRGBColorSpace;
    else tex.encoding = 3001;
    tex.needsUpdate = true;
  }

  // ─── GUI ────────────────────────────────────────────────────────────────────

  _initGuiMode() {
    this.gui = new dat.GUI({ closed: true });

    const defaultSettings = {
      toneMappingExposure: TONE_MAPPING_EXPOSURE,
      pointLightIntensity: POINTLIGHT_INTENSITY,
      directionalLightIntensity: DIRLIGHT_INTENSITY,

      dirLightPosX: 0,
      dirLightPosY: 1.3,
      dirLightPosZ: 0.000001,

      ambientLightIntensity: AMBIENTLIGHT_INTENSITY,
      environmentMapAngle: ENVIRONMENT_MAP_ANGLE,
      environmentMapFlipX: ENVIRONMENT_MAP_FLIP_X,
      environmentMapIntensity: ENVIRONMENT_MAP_INTENSITY,
      shadowTransparency: SHADOW_TRANSPARENCY,
      floorVisible: true,
    };

    const settings = { ...defaultSettings };
    const urlParams = new URLSearchParams(window.location.search);

    const getParam = (key, def) => {
      if (!urlParams.has(key)) return def;
      const val = urlParams.get(key);
      if (val === null || val.trim() === '') return def;
      if (key === 'envFlip' || key === 'floor') { return val === 'true'; }
      const num = parseFloat(val);
      return isNaN(num) ? def : num;
    };

    settings.toneMappingExposure = getParam('exposure', defaultSettings.toneMappingExposure);
    settings.pointLightIntensity = getParam('pointInt', defaultSettings.pointLightIntensity);
    settings.directionalLightIntensity = getParam('dirInt', defaultSettings.directionalLightIntensity);

    settings.dirLightPosX = getParam('dirX', defaultSettings.dirLightPosX);
    settings.dirLightPosY = getParam('dirY', defaultSettings.dirLightPosY);
    settings.dirLightPosZ = getParam('dirZ', defaultSettings.dirLightPosZ);

    settings.ambientLightIntensity = getParam('ambInt', defaultSettings.ambientLightIntensity);
    settings.environmentMapAngle = getParam('envAngle', defaultSettings.environmentMapAngle);
    settings.environmentMapFlipX = getParam('envFlip', defaultSettings.environmentMapFlipX);
    settings.environmentMapIntensity = getParam('envInt', defaultSettings.environmentMapIntensity);
    settings.shadowTransparency = getParam('shadowOp', defaultSettings.shadowTransparency);
    settings.floorVisible = getParam('floor', defaultSettings.floorVisible);

    const applySettings = () => {
      if (this.renderer) this.renderer.toneMappingExposure = settings.toneMappingExposure;
      if (this.scene) {
        this.scene.traverse((obj) => {
          if (obj.isPointLight) obj.intensity = settings.pointLightIntensity;
          if (obj.isAmbientLight) obj.intensity = settings.ambientLightIntensity;
        });
      }

      if (this.dirLight) {
        this.dirLight.intensity = settings.directionalLightIntensity;
        this._initialLightOffset.set(settings.dirLightPosX, settings.dirLightPosY, settings.dirLightPosZ);
        this.dirLight.position.copy(this.dirLight.target.position).add(this._initialLightOffset);
      }

      if (this.scene) {
        const floor = this.scene.getObjectByName('scene_floor');
        if (floor) {
          floor.material.opacity = settings.shadowTransparency;
          floor.visible = settings.floorVisible;
        }
      }

      if (ENVIRONMENT_MAP) {
        if (isNewThreeJs) { this.scene.environmentIntensity = settings.environmentMapIntensity; }
        this._loadEnvMap(this._currentEnvPath, settings.environmentMapIntensity, settings.environmentMapAngle, settings.environmentMapFlipX);
      }
    };

    const updateURL = () => {
      const params = new URLSearchParams();
      params.set('exposure', settings.toneMappingExposure);
      params.set('pointInt', settings.pointLightIntensity);
      params.set('dirInt', settings.directionalLightIntensity);
      params.set('dirX', settings.dirLightPosX);
      params.set('dirY', settings.dirLightPosY);
      params.set('dirZ', settings.dirLightPosZ);
      params.set('ambInt', settings.ambientLightIntensity);
      params.set('envAngle', settings.environmentMapAngle);
      params.set('envFlip', settings.environmentMapFlipX);
      params.set('envInt', settings.environmentMapIntensity);
      params.set('shadowOp', settings.shadowTransparency);
      params.set('floor', settings.floorVisible);
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    };

    const onChange = () => {
      applySettings();
      updateURL();
    };

    const envFolder = this.gui.addFolder('Environment');
    envFolder.add(settings, 'toneMappingExposure', 0, 3).onChange(onChange);
    envFolder.add(settings, 'ambientLightIntensity', 0, 20).onChange(onChange);
    envFolder.add(settings, 'environmentMapIntensity', 0, 3).onChange(onChange);
    if (ENVIRONMENT_MAP_ROTATEBLE) {
      envFolder.add(settings, 'environmentMapAngle', 0, 360).onChange(onChange);
      envFolder.add(settings, 'environmentMapFlipX').onChange(onChange);
    }
    envFolder.open();

    const lightFolder = this.gui.addFolder('Directional Light');
    lightFolder.add(settings, 'directionalLightIntensity', 0, 5).onChange(onChange);
    lightFolder.add(settings, 'dirLightPosX', -20, 20).onChange(onChange);
    lightFolder.add(settings, 'dirLightPosY', 0, 20).onChange(onChange);
    lightFolder.add(settings, 'dirLightPosZ', -20, 20).onChange(onChange);
    lightFolder.open();

    const otherFolder = this.gui.addFolder('Other');
    otherFolder.add(settings, 'pointLightIntensity', 0, 2).onChange(onChange);
    otherFolder.add(settings, 'shadowTransparency', 0, 1).onChange(onChange);
    otherFolder.add(settings, 'floorVisible').onChange(onChange);

    applySettings();
  }
}
