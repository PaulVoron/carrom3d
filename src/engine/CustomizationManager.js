/**
 * CustomizationManager.js
 *
 * Реактивный менеджер кастомизации материалов Three.js.
 * Подписывается на settings.customization в Zustand и при любом изменении
 * загружает/применяет текстуры, цвета, HDR-окружение к 3D-сцене.
 *
 * Архитектура:
 *   - Использует textures.js как единственный источник истины конфигурации.
 *   - Ищет материалы по material.name === textures[category].materialName.
 *   - Загружает текстуры асинхронно, не блокируя RAF.
 *   - Поддерживает repeatX/Y, flipX/Y, rotation, color, metalness, roughness.
 *   - Null-значение карты = удаление карты с материала.
 *
 * Публичный API:
 *   manager.collectMaterials(model)   — собрать ссылки на материалы из модели
 *   manager.setMeshRefs(refs)         — передать ссылки на динамич. фишки/биток
 *   manager.initSubscription()        — подписаться на Zustand и применить всё
 *   manager.dispose()                 — отписаться и освободить ресурсы
 */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import textures from './textures.js';
import { useGameStore } from '../store/useGameStore.js';
import {
  ENVIRONMENT_MAP_INTENSITY,
  ENVIRONMENT_MAP_ANGLE,
  ENVIRONMENT_MAP_FLIP_X,
  ENVIRONMENT_MAP_ROTATEBLE,
  ENVIRONMENT_AS_BACKGROUND,
  ENVIRONMENT_BACKGROUND_INTENSITY,
  ENVIRONMENT_BACKGROUND_BLURRINESS,
  SET_BACKGROUND,
  BACKGROUND_COLOR,
} from './3d-scene-settings.js';

const isNewThreeJs = parseInt(THREE.REVISION) >= 150;

// ─── CustomizationManager ─────────────────────────────────────────────────────

export class CustomizationManager {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.TextureLoader} textureLoader — shared loader
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(scene, textureLoader, renderer) {
    this._scene = scene;
    this._textureLoader = textureLoader;
    this._renderer = renderer;

    /** @type {Record<string, THREE.Material[]>} materialName -> materials[] */
    this._materials = {};

    /** @type {Function | null} Zustand unsubscribe */
    this._unsub = null;

    /** Кешированная текущая HDR-карта для избежания лишних перезагрузок */
    this._currentEnvId = null;
    this._currentEnvMap = null;

    // Меши динамических объектов (фишки, биток) — заполняются через setMeshRefs
    this._whiteCoinMeshes = [];
    this._blackCoinMeshes = [];
    this._queenCoinMeshes = [];
    this._strikerMesh = null;
  }

  // ─── Сбор материалов из модели ───────────────────────────────────────────────

  /**
   * Обходит загруженную модель и собирает ссылки на материалы по их именам.
   * Должен вызываться один раз после loadModel().
   * @param {THREE.Object3D} model
   */
  collectMaterials(model) {
    // Набор всех materialName из конфига
    const targetNames = new Set(
      Object.values(textures)
        .filter((cat) => cat.materialName)
        .map((cat) => cat.materialName)
    );

    model.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (!mat || !targetNames.has(mat.name)) return;
        if (!this._materials[mat.name]) {
          this._materials[mat.name] = [];
        }
        // Избегаем дублей (если один материал на нескольких мешах)
        if (!this._materials[mat.name].includes(mat)) {
          this._materials[mat.name].push(mat);
        }
      });
    });

    console.log('[CustomizationManager] Collected materials:', Object.keys(this._materials));
  }

  /**
   * Передаёт ссылки на динамически созданные меши (фишки, биток).
   * Вызывается из GameOrchestrator после создания физических тел.
   * @param {{ whiteCoinMeshes: THREE.Object3D[], blackCoinMeshes: THREE.Object3D[], queenCoinMeshes: THREE.Object3D[], strikerMesh: THREE.Object3D | null }} refs
   */
  setMeshRefs(refs) {
    this._whiteCoinMeshes = refs.whiteCoinMeshes ?? [];
    this._blackCoinMeshes = refs.blackCoinMeshes ?? [];
    this._queenCoinMeshes = refs.queenCoinMeshes ?? [];
    this._strikerMesh     = refs.strikerMesh ?? null;
  }

  // ─── Подписка ─────────────────────────────────────────────────────────────────

  /**
   * Подписывается на Zustand и немедленно применяет текущие настройки.
   * Вызывается один раз из GameOrchestrator.start() после collectMaterials().
   */
  initSubscription() {
    const state = useGameStore.getState();
    const customization = state.settings.customization;
    const lang = state.language;

    // Немедленное применение
    this._applyAll(customization, lang);

    // Подписываемся на изменения customization
    let prevCustomization = { ...customization };
    this._unsub = useGameStore.subscribe(
      (s) => s.settings.customization,
      (custom) => {
        const currentLang = useGameStore.getState().language;
        this._applyDiff(custom, prevCustomization, currentLang);
        prevCustomization = { ...custom };
      },
      {
        equalityFn: (a, b) =>
          a.strikerId      === b.strikerId      &&
          a.coinSkinId     === b.coinSkinId     &&
          a.boardSurfaceId === b.boardSurfaceId &&
          a.boardPatternId === b.boardPatternId &&
          a.frameId        === b.frameId        &&
          a.frameFinish    === b.frameFinish    &&
          a.pocketCornerId === b.pocketCornerId &&
          a.environmentId  === b.environmentId,
      }
    );
  }

  // ─── Применение всего ────────────────────────────────────────────────────────

  _applyAll(customization, lang) {
    this._applyStriker(customization.strikerId);
    this._applyCoins(customization.coinSkinId);
    this._applyBoardSurface(customization.boardSurfaceId);
    this._applyBoardPattern(customization.boardPatternId);
    this._applyFrame(customization.frameId, customization.frameFinish);
    this._applyPocketCorners(
      customization.pocketCornerId,
      customization.frameId,
      customization.frameFinish
    );
    this._applyEnvironment(customization.environmentId);
  }

  _applyDiff(next, prev, lang) {
    if (next.strikerId !== prev.strikerId) {
      this._applyStriker(next.strikerId);
    }
    if (next.coinSkinId !== prev.coinSkinId) {
      this._applyCoins(next.coinSkinId);
    }
    if (next.boardSurfaceId !== prev.boardSurfaceId) {
      this._applyBoardSurface(next.boardSurfaceId);
    }
    if (next.boardPatternId !== prev.boardPatternId) {
      this._applyBoardPattern(next.boardPatternId);
    }
    // Борта: реагируем на смену текстуры или типа покрытия
    const frameChanged   = next.frameId     !== prev.frameId;
    const finishChanged  = next.frameFinish !== prev.frameFinish;
    if (frameChanged || finishChanged) {
      this._applyFrame(next.frameId, next.frameFinish);
    }
    // Углы: реагируем на их собственную смену, или на изменение бортов (если sameAsFrame)
    const cornerChanged  = next.pocketCornerId !== prev.pocketCornerId;
    const isSameAsFrame  = next.pocketCornerId === 'sameAsFrame';
    if (cornerChanged || (isSameAsFrame && (frameChanged || finishChanged))) {
      this._applyPocketCorners(next.pocketCornerId, next.frameId, next.frameFinish);
    }
    if (next.environmentId !== prev.environmentId) {
      this._applyEnvironment(next.environmentId);
    }
  }

  // ─── Категории ───────────────────────────────────────────────────────────────

  _applyStriker(skinId) {
    const cfg = textures.strikers[skinId];
    if (!cfg) return;
    const matName = textures.strikers.materialName;
    const mats = this._getMaterials(matName);

    mats.forEach((mat) => this._applyTextureMaps(mat, cfg));

    // Также применяем к мешу битка напрямую (он клонируется, не в модели)
    if (this._strikerMesh) {
      this._strikerMesh.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
          if (mat && mat.name === matName) {
            this._applyTextureMaps(mat, cfg);
          }
        });
      });
    }
  }

  _applyCoins(skinId) {
    const cfg = textures.coins[skinId];
    if (!cfg) return;

    // Применяем материал к динамическим мешам фишек
    const applyToMeshes = (meshes, hexColor) => {
      meshes.forEach((obj) => {
        obj.traverse((child) => {
          if (!child.isMesh) return;
          const mat = child.material;
          if (!mat) return;
          // Цвет
          if (hexColor !== undefined && hexColor !== null) {
            mat.color.set(hexColor);
          }
          // Общие параметры
          if (cfg.metalnessMap) {
            mat.metalness = 1.0;
          } else if (cfg.metalness !== null && cfg.metalness !== undefined) {
            mat.metalness = cfg.metalness;
          }

          if (cfg.roughnessMap) {
            mat.roughness = 1.0;
          } else if (cfg.roughness !== null && cfg.roughness !== undefined) {
            mat.roughness = cfg.roughness;
          }

          // Текстурные карты
          this._applyMapsToMaterial(mat, cfg);
          mat.needsUpdate = true;
        });
      });
    };

    applyToMeshes(this._whiteCoinMeshes, cfg.colorWhite);
    applyToMeshes(this._blackCoinMeshes, cfg.colorBlack);
    // Королева сохраняет красный цвет, только PBR-параметры меняются
    applyToMeshes(this._queenCoinMeshes, cfg.colorRed);
  }

  _applyBoardSurface(skinId) {
    const cfg = textures.boardSurface[skinId];
    if (!cfg) return;
    const mats = this._getMaterials(textures.boardSurface.materialName);
    mats.forEach((mat) => this._applyTextureMaps(mat, cfg));
  }

  _applyBoardPattern(skinId) {
    const cfg = textures.boardPattern[skinId];
    if (!cfg) return;
    const mats = this._getMaterials(textures.boardPattern.materialName);
    mats.forEach((mat) => this._applyTextureMaps(mat, cfg));
  }

  _applyFrame(skinId, finish) {
    const cfg = textures.frames[skinId];
    if (!cfg) return;
    const mats = this._getMaterials(textures.frames.materialName);
    const finishCfg = cfg.finishType?.[finish] ?? cfg.finishType?.matte;

    mats.forEach((mat) => {
      // Диффузная карта (общая для matte и glossy)
      this._loadAndApplyMap(mat, 'map', cfg.map, true);
      this._applyTransformProps(mat, cfg);
      // Карты покрытия из finishType
      if (finishCfg) {
        this._loadAndApplyMap(mat, 'normalMap',    finishCfg.normalMap,    false);
        this._loadAndApplyMap(mat, 'roughnessMap', finishCfg.roughnessMap, false);
        this._loadAndApplyMap(mat, 'metalnessMap', finishCfg.metalnessMap, false);
        if (finishCfg.color !== null && finishCfg.color !== undefined) {
          mat.color.set(finishCfg.color);
        } else {
          mat.color.set(0xffffff);
        }
        
        if (finishCfg.metalnessMap) {
          mat.metalness = 1.0;
        } else if (finishCfg.metalness !== null && finishCfg.metalness !== undefined) {
          mat.metalness = finishCfg.metalness;
        } else {
          mat.metalness = 0.0;
        }

        if (finishCfg.roughnessMap) {
          mat.roughness = 1.0;
        } else if (finishCfg.roughness !== null && finishCfg.roughness !== undefined) {
          mat.roughness = finishCfg.roughness;
        } else {
          mat.roughness = 1.0;
        }
      }
      mat.needsUpdate = true;
    });
  }

  _applyPocketCorners(skinId, frameSkinId, frameFinish) {
    const mats = this._getMaterials(textures.pocketCorners.materialName);

    if (skinId === 'sameAsFrame') {
      // Копируем конфиг бортов
      const frameCfg  = textures.frames[frameSkinId];
      if (!frameCfg) return;
      const finishCfg = frameCfg.finishType?.[frameFinish] ?? frameCfg.finishType?.matte;

      mats.forEach((mat) => {
        this._loadAndApplyMap(mat, 'map',          frameCfg.map, true);
        this._applyTransformProps(mat, frameCfg);
        if (finishCfg) {
          this._loadAndApplyMap(mat, 'normalMap',    finishCfg.normalMap,    false);
          this._loadAndApplyMap(mat, 'roughnessMap', finishCfg.roughnessMap, false);
          this._loadAndApplyMap(mat, 'metalnessMap', finishCfg.metalnessMap, false);
          if (finishCfg.color !== null && finishCfg.color !== undefined) {
            mat.color.set(finishCfg.color);
          } else {
            mat.color.set(0xffffff);
          }
          
          if (finishCfg.metalnessMap) {
            mat.metalness = 1.0;
          } else if (finishCfg.metalness !== null && finishCfg.metalness !== undefined) {
            mat.metalness = finishCfg.metalness;
          } else {
            mat.metalness = 0.0;
          }

          if (finishCfg.roughnessMap) {
            mat.roughness = 1.0;
          } else if (finishCfg.roughness !== null && finishCfg.roughness !== undefined) {
            mat.roughness = finishCfg.roughness;
          } else {
            mat.roughness = 1.0;
          }
        }
        mat.needsUpdate = true;
      });
    } else {
      const cfg = textures.pocketCorners[skinId];
      if (!cfg) return;
      mats.forEach((mat) => this._applyTextureMaps(mat, cfg));
    }
  }

  _applyEnvironment(envId) {
    if (envId === this._currentEnvId) return;
    this._currentEnvId = envId;

    const cfg = textures.environments[envId];
    if (!cfg || !cfg.file) return;

    const pmrem = new THREE.PMREMGenerator(this._renderer);
    pmrem.compileEquirectangularShader();

    new RGBELoader().load(
      cfg.file,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;

        let envMap;
        if (ENVIRONMENT_MAP_ROTATEBLE) {
          const tmpScene = new THREE.Scene();
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 32),
            new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide })
          );
          sphere.scale.x = ENVIRONMENT_MAP_FLIP_X ? 1 : -1;
          sphere.rotation.y = THREE.MathUtils.degToRad(180 - ENVIRONMENT_MAP_ANGLE);
          tmpScene.add(sphere);
          envMap = pmrem.fromScene(tmpScene).texture;
        } else {
          envMap = pmrem.fromEquirectangular(texture).texture;
        }

        // Освобождаем старую карту
        if (this._currentEnvMap) {
          this._currentEnvMap.dispose();
        }
        this._currentEnvMap = envMap;

        this._scene.environment = envMap;
        if (isNewThreeJs) this._scene.environmentIntensity = ENVIRONMENT_MAP_INTENSITY;

        if (ENVIRONMENT_AS_BACKGROUND) {
          this._scene.background = envMap;
          if ('backgroundIntensity' in this._scene) this._scene.backgroundIntensity = ENVIRONMENT_BACKGROUND_INTENSITY;
          if ('backgroundBlurriness' in this._scene) this._scene.backgroundBlurriness = ENVIRONMENT_BACKGROUND_BLURRINESS;
        } else {
          if (SET_BACKGROUND) {
            this._scene.background = new THREE.Color(BACKGROUND_COLOR || 0xffffff);
          } else {
            this._scene.background = null;
          }
        }

        texture.dispose();
        pmrem.dispose();
      },
      undefined,
      (err) => {
        console.warn('[CustomizationManager] Failed to load HDR:', cfg.file, err);
        pmrem.dispose();
      }
    );
  }

  // ─── Утилиты применения текстур ──────────────────────────────────────────────

  /**
   * Универсальный метод: применяет все поля конфига к материалу.
   * Для категорий без finishType (биток, поверхность, паттерн, углы).
   */
  _applyTextureMaps(mat, cfg) {
    if (!mat || !cfg) return;

    this._loadAndApplyMap(mat, 'map',          cfg.map,          true);
    this._loadAndApplyMap(mat, 'normalMap',    cfg.normalMap,    false);
    this._loadAndApplyMap(mat, 'roughnessMap', cfg.roughnessMap, false);
    this._loadAndApplyMap(mat, 'metalnessMap', cfg.metalnessMap, false);

    this._applyTransformProps(mat, cfg);

    if (cfg.color !== null && cfg.color !== undefined) {
      mat.color.set(cfg.color);
    } else {
      mat.color.set(0xffffff);
    }

    if (cfg.metalnessMap) {
      mat.metalness = 1.0;
    } else if (cfg.metalness !== null && cfg.metalness !== undefined) {
      mat.metalness = cfg.metalness;
    } else {
      mat.metalness = 0.0;
    }

    if (cfg.roughnessMap) {
      mat.roughness = 1.0;
    } else if (cfg.roughness !== null && cfg.roughness !== undefined) {
      mat.roughness = cfg.roughness;
    } else {
      mat.roughness = 1.0;
    }

    mat.needsUpdate = true;
  }

  /**
   * Применяет только текстурные карты к материалу (без color/metalness/roughness).
   * Используется для фишек, где цвет задаётся отдельно.
   */
  _applyMapsToMaterial(mat, cfg) {
    this._loadAndApplyMap(mat, 'map',          cfg.map,          true);
    this._loadAndApplyMap(mat, 'normalMap',    cfg.normalMap,    false);
    this._loadAndApplyMap(mat, 'roughnessMap', cfg.roughnessMap, false);
    this._loadAndApplyMap(mat, 'metalnessMap', cfg.metalnessMap, false);
    this._applyTransformProps(mat, cfg);
    mat.needsUpdate = true;
  }

  /**
   * Асинхронно загружает текстуру и присваивает нужному слоту материала.
   * Если path === null — удаляет карту.
   * @param {THREE.Material} mat
   * @param {'map'|'normalMap'|'roughnessMap'|'metalnessMap'} slot
   * @param {string|null} path
   * @param {boolean} isSRGB — true только для diffuse (map)
   */
  _loadAndApplyMap(mat, slot, path, isSRGB) {
    if (path === null || path === undefined) {
      if (mat[slot]) {
        mat[slot].dispose();
        mat[slot] = null;
        mat.needsUpdate = true;
      }
      return;
    }

    this._textureLoader.load(path, (tex) => {
      tex.flipY = false;
      if (isSRGB && isNewThreeJs) {
        tex.colorSpace = THREE.SRGBColorSpace;
      }
      tex.anisotropy = this._renderer.capabilities.getMaxAnisotropy
        ? Math.min(this._renderer.capabilities.getMaxAnisotropy(), 16)
        : 4;

      // Применяем transform из текущего cfg (берём из материала-замены если уже была)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;

      // Освобождаем старую текстуру
      if (mat[slot] && mat[slot] !== tex) {
        mat[slot].dispose();
      }
      mat[slot] = tex;
      mat.needsUpdate = true;
    });
  }

  /**
   * Применяет repeat/flip/rotation к уже установленной текстуре slot.
   * Вызывать после загрузки или при смене конфига.
   */
  _applyTransformProps(mat, cfg) {
    // repeat, flip, rotation — применяем ко всем картам если они есть
    const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'];
    const repeatX = cfg.repeatX ?? 1;
    const repeatY = cfg.repeatY ?? 1;
    const flipX   = cfg.flipX   ?? false;
    const flipY   = cfg.flipY   ?? false;
    const rot     = cfg.rotation ?? 0;

    slots.forEach((slot) => {
      const tex = mat[slot];
      if (!tex) return;
      tex.wrapS = cfg.clampToEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      tex.wrapT = cfg.clampToEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      tex.repeat.set(
        repeatX * (flipX ? -1 : 1),
        repeatY * (flipY ? -1 : 1)
      );
      
      let ox = cfg.offset?.x ?? 0;
      let oy = cfg.offset?.y ?? 0;
      if (flipX) ox += repeatX;
      if (flipY) oy += repeatY;
      tex.offset.set(ox, oy);

      tex.rotation = rot;
      tex.needsUpdate = true;
    });
  }

  /**
   * Возвращает массив материалов по имени из кеша.
   * @param {string} materialName
   * @returns {THREE.Material[]}
   */
  _getMaterials(materialName) {
    return this._materials[materialName] ?? [];
  }

  // ─── Dispose ─────────────────────────────────────────────────────────────────

  dispose() {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    if (this._currentEnvMap) {
      this._currentEnvMap.dispose();
      this._currentEnvMap = null;
    }
  }
}
