'use strict';
/* global dat */

//#region PUBLIC VALUES

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as dat from 'dat.gui';

// import { changeGlobalMorph } from './system/morphSystem.js';

import {
  TONE_MAPPING_EXPOSURE,
  POINTLIGHT_INTENSITY,
  DIRLIGHT_INTENSITY,
  AMBIENTLIGHT_INTENSITY,
  ENVIRONMENT_MAP_ROTATEBLE,
  ENVIRONMENT_MAP_ANGLE,
  ENVIRONMENT_MAP_FLIP_X,
  BACKGROUND_COLOR,
  MODELS,
  ENVIRONMENT_MAP,
  ENVIRONMENT_MAP_INTENSITY,
  MODEL_CENTER_POSITION,
  CONTROL_TARGET_POSITION_Y,
  START_CAMERA_POSITION,
  SHADOW_TRANSPARENCY,
  ADD_POINTLIGHT,
  ADD_DIRLIGHT,
  ADD_AMBIENTLIGHT,
  ADD_FLOOR,
  GUI_MODE_LIGHTING,
  DEV_MODE_HELPERS,
  RENDER_SCALE,
  CONTROLS_ENABLE_PAN,
  CONTROLS_FIX_VERTICAL_PAN,
  ENABLE_ASSEMBLY_ANIMATION,
  FIT_CAMERA_TO_OBJECT,
} from '../src/engine/3d-scene-settings.js';

const isNewThreeJs = parseInt(THREE.REVISION) >= 150;

export let floor;
const correctionFloor = 0;
let floorMaterial;

export const canvas = document.getElementById('ar_model_view');

export let scene;
export let renderer;
export let composer;
export let camera;
export let controls;
export let envMap;
export let ambientLight;
export let dirLight;
export let dirLight2;
export let pointLight;
export let pointLight2;

export let gui;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

let morphFolder = null;
let sceneGraphFolder = null;

let initialLightOffset;
let currentEnvPath = ENVIRONMENT_MAP;

//#endregion

//#region DEVICE DETECTION and PERFORMANCE SELECTION

const isLowPerformance = isWeakDevice();
// const isLowPerformance = false;

function isWeakDevice() {
  if (navigator.hardwareConcurrency < 4) return true;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      if (!/Intel/i.test(renderer)) return false;
      const isModernIntel = /Iris\s?Xe/i.test(renderer) || /Arc/i.test(renderer);
      if (isModernIntel) return false;
      const isLegacyIntel = /HD\s?Graphics/i.test(renderer) ||
        /UHD\s?Graphics\s?6/i.test(renderer) ||
        (/Iris/i.test(renderer) && !/Xe/i.test(renderer));
      if (isLegacyIntel) return true;
    }
    // eslint-disable-next-line no-unused-vars
  } catch (e) { return false; }
  return false;
}

//#endregion

//#region RENDER REQUEST SETUP

let renderRequested = false;

export function requestRender() {
  if (!renderRequested) {
    renderRequested = true;
  }
}

export function requestDelayedRender() {
  requestRender();
  setTimeout(requestRender, 50);
  setTimeout(requestRender, 100);
  setTimeout(requestRender, 500);
  setTimeout(requestRender, 1000);
}
//#endregion

//#region SCENE COMPONENTS

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR || 0xffffff);
  if (DEV_MODE_HELPERS) {
    const axesHelper = new THREE.AxesHelper(10);
    scene.add(axesHelper);
  }
  window.scene = scene;
}

function initCamera() {
  const startCameraPosition = new THREE.Vector3(
    START_CAMERA_POSITION[0],
    START_CAMERA_POSITION[1],
    START_CAMERA_POSITION[2]
  );

  camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
  if (startCameraPosition) {
    camera.position.copy(startCameraPosition);
  }
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMapSoft = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxPixelRatio = isLowPerformance ? 1.5 : 2;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  const renderScale = isLowPerformance ? 0.9 : RENDER_SCALE;
  renderer.setPixelRatio(pixelRatio * renderScale);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

  if (isNewThreeJs) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.useLegacyLights = false;
  } else {
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
  }
}

export function updateRenderSize(forceResize = false) {
  if (!renderer) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  const needResize = renderer.domElement.width !== width || renderer.domElement.height !== height;

  if (needResize || forceResize) {
    renderer.setSize(width, height, false);
    if (composer) { composer.setSize(width, height); }
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    controls.update();
  }
}

function initLights() {
  if (ADD_AMBIENTLIGHT) {
    ambientLight = new THREE.AmbientLight(0x404040);
    ambientLight.intensity = 0;
    scene.add(ambientLight);
  }

  if (ADD_DIRLIGHT) {
    const cameraSize = 3;
    dirLight = new THREE.DirectionalLight(0xffffff, DIRLIGHT_INTENSITY);
    dirLight.position.set(0, 12, 0.000001);
    dirLight.castShadow = true;
    dirLight.shadow.bias = -0.001;
    dirLight.shadow.camera.left = -cameraSize;
    dirLight.shadow.camera.right = cameraSize;
    dirLight.shadow.camera.top = cameraSize;
    dirLight.shadow.camera.bottom = -cameraSize;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;

    const shadowSize = isLowPerformance ? 1024 : 2048;
    dirLight.shadow.mapSize = new THREE.Vector2(shadowSize, shadowSize);
    dirLight.shadow.radius = isLowPerformance ? 10 : 20;
    dirLight.shadow.blurSamples = isLowPerformance ? 5 : 20;

    initialLightOffset = new THREE.Vector3().subVectors(dirLight.position, dirLight.target.position);

    scene.add(dirLight);
    scene.add(dirLight.target);

    if (ADD_POINTLIGHT) {
      pointLight = new THREE.PointLight(0xfff4e6, POINTLIGHT_INTENSITY, 3, 0);
      pointLight.position.set(2, MODEL_CENTER_POSITION + 1.8, 0);
      scene.add(pointLight);
      pointLight2 = new THREE.PointLight(0xfff4e6, POINTLIGHT_INTENSITY, 3, 0);
      pointLight2.position.set(-2, MODEL_CENTER_POSITION + 1.8, 0);
      scene.add(pointLight2);
      const fillLight = new THREE.PointLight(0xfff4e6, POINTLIGHT_INTENSITY * 0.3, 4, 0);
      fillLight.position.set(0, MODEL_CENTER_POSITION + 1, -2);
      scene.add(fillLight);
    }

    if (DEV_MODE_HELPERS) {
      const helperDir = new THREE.DirectionalLightHelper(dirLight, 2, 0xff0000);
      scene.add(helperDir);
    }
  }

  if (ADD_POINTLIGHT && !ADD_DIRLIGHT) {
    pointLight = new THREE.PointLight(0xfff4e6, POINTLIGHT_INTENSITY, 3, 0);
    pointLight.position.set(2, MODEL_CENTER_POSITION + 1.8, 0);
    scene.add(pointLight);
    pointLight2 = new THREE.PointLight(0xffffff, POINTLIGHT_INTENSITY, 3, 0);
    pointLight2.position.set(-2, MODEL_CENTER_POSITION + 1.8, 0);
    scene.add(pointLight2);
  }
}

function initFloor() {
  const floorGeometry = new THREE.PlaneGeometry(5000, 5000, 1, 1);
  floorMaterial = new THREE.ShadowMaterial();
  floorMaterial.opacity = SHADOW_TRANSPARENCY;
  floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'scene_floor';
  floor.rotation.x = -0.5 * Math.PI;
  floor.receiveShadow = true;
  floor.position.y = MODEL_CENTER_POSITION + correctionFloor;
  floor.frustumCulled = false;
  scene.add(floor);
}

export function updateEnvMap(path, intensity, angle = ENVIRONMENT_MAP_ANGLE, flipX = ENVIRONMENT_MAP_FLIP_X, updateSceneBackground = false) {
  if (path == null) { return; }

  currentEnvPath = path;

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const hdrLoader = new RGBELoader();

  hdrLoader.load(path, function (texture) {
    texture.mapping = THREE.EquirectangularReflectionMapping;

    const envResElement = document.getElementById('info-env-res');
    if (envResElement && texture.image) {
      envResElement.textContent = `(${texture.image.width} x ${texture.image.height} px)`;
    }

    if (ENVIRONMENT_MAP_ROTATEBLE) {
      const sceneFlipped = new THREE.Scene();
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 32),
        new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.BackSide
        })
      );
      sphere.scale.x = flipX ? 1 : -1;
      sceneFlipped.add(sphere);
      const radAngle = THREE.MathUtils.degToRad(180 - angle);
      sphere.rotation.y = radAngle;
      envMap = pmremGenerator.fromScene(sceneFlipped).texture;
    } else {
      envMap = pmremGenerator.fromEquirectangular(texture).texture;
    }

    scene.environment = envMap;

    if (isNewThreeJs) {
      scene.environmentIntensity = intensity;
    }

    if (updateSceneBackground) {
      scene.background = envMap;
    }

    if (!isNewThreeJs) {
      scene.traverse((object) => {
        if (object.isMesh && object.material) {
          if (object.material.envMap) {
            object.material.envMap = envMap;
            object.material.envMapIntensity = intensity;
            object.material.needsUpdate = true;
          }
        }
      });
    }

    texture.dispose();
    pmremGenerator.dispose();
    requestRender();
  }, undefined, function (err) {
    console.warn('Failed to load HDR environment map:', path, err);
    // Fallback: simple hemispheric light if env map fails
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(hemiLight);
  });
}

function initEnvMap() {
  if (ENVIRONMENT_MAP && ENVIRONMENT_MAP !== '') {
    updateEnvMap(ENVIRONMENT_MAP, ENVIRONMENT_MAP_INTENSITY, ENVIRONMENT_MAP_ANGLE, ENVIRONMENT_MAP_FLIP_X);
  } else {
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 1.2);
    hemiLight.position.set(0, 0, 0);
    scene.add(hemiLight);
  }
}

function initControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  // controls.enableDamping = !isLowPerformance;
  controls.enableDamping = true;
  controls.enablePan = CONTROLS_ENABLE_PAN;
  controls.dampingFactor = 0.25;
  controls.autoRotateSpeed = -0.5;
  controls.maxDistance = 50;
  controls.minDistance = 0.2;
  controls.autoRotate = false;
  controls.enableZoom = true;
  controls.target.set(0, CONTROL_TARGET_POSITION_Y, 0);

  if (DEV_MODE_HELPERS) {
    controls.enablePan = true;
    controls.minDistance = 0.01;
  }

  controls.addEventListener('change', () => {
    requestRender();
    if (CONTROLS_FIX_VERTICAL_PAN) { controls.target.y = CONTROL_TARGET_POSITION_Y; }
  });

  controls.addEventListener('end', () => {
    controls.autoRotate = false;

    if (DEV_MODE_HELPERS) {
      consoleLogPosition('camera', camera.position, 3);
      consoleLogPosition('target', controls.target, 3);
    }
  });

  function consoleLogPosition(text = '', pos, num = 2) {
    let k = 1;
    for (let i = 0; i < num; i++) {
      k = k * 10;
    }
    const x = Math.round(pos.x * k) / k;
    const y = Math.round(pos.y * k) / k;
    const z = Math.round(pos.z * k) / k;
    console.log('🚀 ' + text + ':[' + x + ', ' + y + ', ' + z + '],');
  }
}

function initAnimate(onBeforeRender) {
  let lastTime = performance.now();

  function animate(time) {
    requestAnimationFrame(animate);
    if (document.hidden) return;

    if (onBeforeRender) onBeforeRender();

    const isControlsMoving = controls && controls.update();

    const delta = time - lastTime;
    const currentInterval = isLowPerformance ? (1000 / 30) : (1000 / 60);

    if (delta >= currentInterval) {
      lastTime = time - (delta % currentInterval);

      if (resizeRendererToDisplaySize(renderer)) {
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
      }

      renderer.render(scene, camera);
    }
  }
  requestAnimationFrame(animate);
}

function resizeRendererToDisplaySize(renderer) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  const needResize = renderer.domElement.width !== width || renderer.domElement.height !== height;
  return needResize;
}

//#endregion

//#region //! MAIN
export async function create3DScene(onBeforeRender, shouldImportAllModels = false) {
  initScene();
  initCamera();
  initRenderer();
  initControls();
  initEnvMap();
  initLights();
  (ADD_FLOOR) && initFloor();

  (shouldImportAllModels) && await importAllModelsWithoutAddingToScene(MODELS);

  initAnimate(onBeforeRender);

  updateRenderSize();
  window.addEventListener('resize', () => {
    updateRenderSize();
    requestRender();
  });

  window.addEventListener('click', requestDelayedRender);
  window.addEventListener('touchstart', requestDelayedRender);
  window.addEventListener('input', requestRender);
  window.addEventListener('change', requestDelayedRender);

  (GUI_MODE_LIGHTING) && initGuiMode();
}
//#endregion

//#region MODEL LOADING FUNCTIONS

export async function importAllModelsWithoutAddingToScene(modelsObj) {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);

  const loadPromises = Object.entries(modelsObj).map(([key, { path }]) =>
    loader.loadAsync(path)
      .then(gltf => {
        const model = gltf.scene;
        processLoadedModel(model);
        return { key, model };
      })
      .catch(error => {
        console.error(`Failed to load model ${path}:`, error);
        return { key, model: null };
      })
  );
  const results = await Promise.all(loadPromises);
  results.forEach(({ key, model }) => {
    if (model) { modelsObj[key].model = model; }
    else { console.warn(`Model for key ${key} failed to load`); }
  });
}

function processLoadedModel(model) {
  model.traverse((o) => {
    if (o.isMesh) {
      o.visible = true;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;

      if (o.geometry.attributes.uv && !o.geometry.attributes.uv2) {
        o.geometry.setAttribute('uv2', o.geometry.attributes.uv);
      }

      if (o.material.map) {
        o.material.map.anisotropy = isLowPerformance ? 4 : 16;
        if (isNewThreeJs) { o.material.map.colorSpace = THREE.SRGBColorSpace; }
        else { o.material.map.encoding = THREE.sRGBEncoding; }
        o.material.map.needsUpdate = true;
        o.material.needsUpdate = true;
        requestRender();
      }

      if (ENVIRONMENT_MAP !== '' && !isNewThreeJs) {
        o.material.envMap = envMap;
        o.material.envMapIntensity = ENVIRONMENT_MAP_INTENSITY;
        o.material.needsUpdate = true;
        requestRender();
      }
    }
  });

  const scale = 1;
  model.scale.set(scale, scale, scale);
  model.position.y = MODEL_CENTER_POSITION;

  model.updateMatrixWorld(true);

  const boundingBox = new THREE.Box3().setFromObject(model);
  const size = boundingBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  updateShadowCamera([model]);

  // ------------------------------------------------------------
  if (camera && controls && FIT_CAMERA_TO_OBJECT) {
    fitCameraToObject(camera, model, controls, true);
  }

  if (ENABLE_ASSEMBLY_ANIMATION && window.gsap) {
    assembleModelAnimation(model, maxDim);
  }

  console.log("🚀 ~ scene ~ 🚀:", scene);
  console.log("------------------------");
  console.log("🚀 ~ model ~ 🚀:", model);
}

export async function loadModel(url, needToAddToScene = true) {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  try {
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;

    model.animations = gltf.animations;

    processLoadedModel(model);
    (needToAddToScene) && scene.add(model);

    return model;
  } catch (error) {
    console.error(`Failed to load model from ${url}:`, error);
    return null;
  }
}

export function removeObject(object) {
  if (!object) return;
  scene.remove(object);
  object.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => disposeMaterial(mat));
        } else {
          disposeMaterial(child.material);
        }
      }
    }
  });
}

function disposeMaterial(material) {
  material.dispose();
  for (const key in material) {
    if (material[key] && material[key].isTexture) {
      material[key].dispose();
    }
  }
}

//#endregion

//#region CAMERA and SHADOW CAMERA UPDATING and AMIMATION

export function updateShadowCamera(objectsToInclude, light = dirLight) {
  if (!light || !objectsToInclude || objectsToInclude.length === 0) return;

  const boundingBox = new THREE.Box3();
  objectsToInclude.forEach(object => {
    if (object) { boundingBox.expandByObject(object); }
  });

  if (boundingBox.isEmpty()) { return; }

  const center = boundingBox.getCenter(new THREE.Vector3());
  const size = boundingBox.getSize(new THREE.Vector3());

  light.target.position.copy(center);
  light.target.updateMatrixWorld();
  light.position.copy(center).add(initialLightOffset);

  const maxSize = Math.max(size.x, size.z);
  const cameraSize = maxSize / 2 * 1.5;

  light.shadow.camera.left = -cameraSize;
  light.shadow.camera.right = cameraSize;
  light.shadow.camera.top = cameraSize;
  light.shadow.camera.bottom = -cameraSize;

  light.shadow.camera.updateProjectionMatrix();
}

function fitCameraToObject(camera, object, controls, animated = false) {
  const boundingBox = new THREE.Box3().setFromObject(object);
  const center = boundingBox.getCenter(new THREE.Vector3());
  const size = boundingBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraDistance = Math.abs((maxDim / 2) / Math.tan(fov / 2));

  const aspect = camera.aspect;
  if (size.x > size.y && aspect < 1) {
    cameraDistance = cameraDistance / aspect;
  }

  cameraDistance *= 1.2;
  const direction = new THREE.Vector3(1, 0, 1.5).normalize();
  const newPos = direction.multiplyScalar(cameraDistance).add(center);

  if (size.y > 1.5) {
    newPos.y = center.y;
  } else if (size.y > 0.8 && size.y < 1.5) {
    newPos.y = center.y + (size.y * 0.5);
  } else if (size.y < 0.5) {
    newPos.y = center.y + (size.y * 0.5);
  } else {
    newPos.y = center.y + (size.y * 0.5) + 1;
  }

  if (window.gsap && animated) {
    controls.enabled = false;

    window.gsap.to(camera.position, {
      x: newPos.x, y: newPos.y, z: newPos.z,
      duration: 2, ease: "power2.inOut",
      onUpdate: () => {
        controls.update();
        requestRender();
      },
      onComplete: () => {
        controls.enabled = true;
        controls.update();
        requestRender();
      }
    });
    window.gsap.to(controls.target, {
      x: center.x, y: center.y, z: center.z,
      duration: 1.5, ease: "power2.inOut"
    });
  } else {
    camera.position.copy(newPos);
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }

  requestDelayedRender();
}

function assembleModelAnimation(model, maxDim) {
  const scatterRadius = maxDim * 1.5;
  let maxDuration = 0;

  model.traverse((child) => {
    if (child.isMesh) {
      const origPos = child.position.clone();
      const origRot = { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z };
      const origScale = child.scale.clone();

      const randomDir = new THREE.Vector3(
        Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
      ).normalize();

      const randomDist = Math.random() * scatterRadius + (scatterRadius * 0.5);
      child.position.add(randomDir.multiplyScalar(randomDist));
      child.scale.set(0.001, 0.001, 0.001);

      const delay = Math.random() * 1.2;
      const duration = 1 + Math.random() * 1.5;
      if (delay + duration > maxDuration) { maxDuration = delay + duration; }

      window.gsap.to(child.position, {
        x: origPos.x, y: origPos.y, z: origPos.z,
        duration: duration, delay: delay, ease: "back.out(1.2)"
      });
      window.gsap.to(child.rotation, {
        x: origRot.x, y: origRot.y, z: origRot.z,
        duration: duration, delay: delay, ease: "power2.out"
      });
      window.gsap.to(child.scale, {
        x: origScale.x, y: origScale.y, z: origScale.z,
        duration: duration, delay: delay, ease: "back.out(1.5)"
      });
    }
  });

  window.gsap.to({}, {
    duration: maxDuration,
    onUpdate: requestRender,
    onComplete: () => {
      model.updateMatrixWorld(true);
      updateShadowCamera([model]);
      requestDelayedRender();
    }
  });
}

//#endregion

//#region GUI

function initGuiMode() {
  gui = new dat.GUI();

  const defaultSettings = {
    toneMappingExposure: TONE_MAPPING_EXPOSURE,
    pointLightIntensity: POINTLIGHT_INTENSITY,
    directionalLightIntensity: DIRLIGHT_INTENSITY,

    dirLightPosX: 0,
    dirLightPosY: 12,
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

  if (renderer) renderer.toneMappingExposure = settings.toneMappingExposure;
  if (pointLight) { pointLight.intensity = settings.pointLightIntensity; pointLight2.intensity = settings.pointLightIntensity; }
  if (ambientLight) ambientLight.intensity = settings.ambientLightIntensity;

  if (dirLight) {
    dirLight.intensity = settings.directionalLightIntensity;
    initialLightOffset.set(settings.dirLightPosX, settings.dirLightPosY, settings.dirLightPosZ);
    dirLight.position.copy(dirLight.target.position).add(initialLightOffset);
  }

  if (floor && floorMaterial) {
    floorMaterial.opacity = settings.shadowTransparency;
    floor.visible = settings.floorVisible;
  }

  if (ENVIRONMENT_MAP) {
    if (isNewThreeJs) { scene.environmentIntensity = settings.environmentMapIntensity; }
    updateEnvMap(currentEnvPath, settings.environmentMapIntensity, settings.environmentMapAngle, settings.environmentMapFlipX, false);
  }

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
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  };

  gui.add(settings, 'toneMappingExposure', 0, 4, 0.1).name('Exposure').onChange((value) => {
    if (renderer) renderer.toneMappingExposure = value;
    requestRender();
  }).onFinishChange(updateURL);

  if (ADD_POINTLIGHT) {
    gui.add(settings, 'pointLightIntensity', 0, 10, 0.1).name('Point Light').onChange((value) => {
      if (pointLight) { pointLight.intensity = value; pointLight2.intensity = value; }
      requestRender();
    }).onFinishChange(updateURL);
  }

  if (ADD_DIRLIGHT && dirLight) {
    const dirFolder = gui.addFolder('Directional Light');

    dirFolder.add(settings, 'directionalLightIntensity', 0, 15, 0.1).name('Intensity').onChange((value) => {
      dirLight.intensity = value;
      requestRender();
    }).onFinishChange(updateURL);

    const onLightPosChange = () => {
      initialLightOffset.set(settings.dirLightPosX, settings.dirLightPosY, settings.dirLightPosZ);
      dirLight.position.copy(dirLight.target.position).add(initialLightOffset);
      requestRender();
    };

    dirFolder.add(settings, 'dirLightPosX', -50, 50, 0.1).name('Position X').onChange(onLightPosChange).onFinishChange(updateURL);
    dirFolder.add(settings, 'dirLightPosY', -50, 50, 0.1).name('Position Y').onChange(onLightPosChange).onFinishChange(updateURL);
    dirFolder.add(settings, 'dirLightPosZ', -50, 50, 0.1).name('Position Z').onChange(onLightPosChange).onFinishChange(updateURL);
  }

  if (ADD_AMBIENTLIGHT) {
    gui.add(settings, 'ambientLightIntensity', 0, 15, 0.1).name('Ambient Light').onChange((value) => {
      if (ambientLight) ambientLight.intensity = value;
      requestRender();
    }).onFinishChange(updateURL);
  }

  if (ENVIRONMENT_MAP) {
    gui.add(settings, 'environmentMapAngle', 0, 360, 1).name('Env Map Angle').onChange((value) => {
      if (ENVIRONMENT_MAP_ROTATEBLE) { updateEnvMap(currentEnvPath, settings.environmentMapIntensity, value, settings.environmentMapFlipX, false); }
    }).onFinishChange(updateURL);

    gui.add(settings, 'environmentMapFlipX').name('Flip Env Map X').onChange((value) => {
      if (ENVIRONMENT_MAP_ROTATEBLE) { updateEnvMap(currentEnvPath, settings.environmentMapIntensity, settings.environmentMapAngle, value, false); }
    }).onFinishChange(updateURL);

    gui.add(settings, 'environmentMapIntensity', 0, 7, 0.1).name('Env Map Intensity').onChange((value) => {
      if (isNewThreeJs) { scene.environmentIntensity = value; }
      else {
        scene.traverse((object) => {
          if (object.isMesh && object.material && object.material.envMap) {
            object.material.envMapIntensity = value;
            object.material.needsUpdate = true;
          }
        });
      }
      requestRender();
    }).onFinishChange(updateURL);
  }

  if (ADD_FLOOR && floor) {
    const floorFolder = gui.addFolder('Floor');
    settings.floorVisible = floor.visible;
    floorFolder.add(settings, 'floorVisible').name('Show Floor').onChange((value) => {
      if (floor) floor.visible = value;
      requestRender();
    }).onFinishChange(updateURL);

    floorFolder.add(settings, 'shadowTransparency', 0, 1, 0.01).name('Shadow Opacity').onChange((value) => {
      if (floorMaterial) floorMaterial.opacity = value;
      requestRender();
    }).onFinishChange(updateURL);
  }

  const resetSettings = {
    reset: () => {
      Object.assign(settings, defaultSettings);

      if (gui.__controllers) { gui.__controllers.forEach(c => c.updateDisplay()); }
      if (gui.__folders) {
        Object.values(gui.__folders).forEach(folder => {
          if (folder.__controllers) { folder.__controllers.forEach(c => c.updateDisplay()); }
        });
      }

      if (renderer) renderer.toneMappingExposure = settings.toneMappingExposure;
      if (pointLight) { pointLight.intensity = settings.pointLightIntensity; pointLight2.intensity = settings.pointLightIntensity; }

      if (dirLight) {
        dirLight.intensity = settings.directionalLightIntensity;
        initialLightOffset.set(settings.dirLightPosX, settings.dirLightPosY, settings.dirLightPosZ);
        dirLight.position.copy(dirLight.target.position).add(initialLightOffset);
      }

      if (ambientLight) ambientLight.intensity = settings.ambientLightIntensity;
      if (ENVIRONMENT_MAP) {
        if (isNewThreeJs) scene.environmentIntensity = settings.environmentMapIntensity;
        updateEnvMap(currentEnvPath, settings.environmentMapIntensity, settings.environmentMapAngle, settings.environmentMapFlipX, false);
      }
      if (floor) {
        floor.visible = settings.floorVisible;
        if (floorMaterial) floorMaterial.opacity = settings.shadowTransparency;
      }
      requestRender();
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  gui.add(resetSettings, 'reset').name('RESET SETTINGS');

  gui.close();
}

export function updateTechInfoUI(model) {
  if (!model) return;
  let meshesCount = 0;
  let verticesCount = 0;
  let trianglesCount = 0;
  let morphNames = new Set();

  model.traverse((node) => {
    if (node.isMesh) {
      meshesCount++;
      const geom = node.geometry;
      if (geom.attributes.position) {
        verticesCount += geom.attributes.position.count;
      }
      if (geom.index !== null) {
        trianglesCount += geom.index.count / 3;
      } else if (geom.attributes.position) {
        trianglesCount += geom.attributes.position.count / 3;
      }
      if (node.morphTargetDictionary) {
        Object.keys(node.morphTargetDictionary).forEach(k => morphNames.add(k));
      }
    }
  });

  const animsText = (model.animations && model.animations.length > 0)
    ? model.animations.map(a => a.name || 'Unnamed').join(', ')
    : 'None';

  const morphsText = morphNames.size > 0 ? Array.from(morphNames).join(', ') : 'None';

  document.getElementById('tech-meshes').textContent = meshesCount;
  document.getElementById('tech-vertices').textContent = verticesCount.toLocaleString();
  document.getElementById('tech-triangles').textContent = trianglesCount.toLocaleString();
  document.getElementById('tech-animations').textContent = animsText;
  document.getElementById('tech-morphs').textContent = morphsText;
}

export function updateModelGui(model) {
  if (!model || !gui) return;

  if (morphFolder) { gui.removeFolder(morphFolder); morphFolder = null; }
  if (sceneGraphFolder) { gui.removeFolder(sceneGraphFolder); sceneGraphFolder = null; }

  let morphNames = new Set();
  model.traverse(node => {
    if (node.isMesh && node.morphTargetDictionary) {
      Object.keys(node.morphTargetDictionary).forEach(k => morphNames.add(k));
    }
  });

  if (morphNames.size > 0) {
    morphFolder = gui.addFolder('Morph Targets');

    const morphData = {};

    morphNames.forEach(name => {
      morphData[name] = 0;
      morphFolder.add(morphData, name, 0, 1, 0.01).onChange(val => {
        changeGlobalMorph(name, val);
      });
    });
  }

  sceneGraphFolder = gui.addFolder('Scene Graph');
  const masterData = { showAllMeshes: true };

  let meshCount = 0;
  model.traverse(n => { if (n.isMesh) meshCount++; });

  if (meshCount === 0) return;

  sceneGraphFolder.add(masterData, 'showAllMeshes').name('Show All Meshes').onChange(val => {
    model.traverse(node => {
      if (node.isMesh && node.name !== 'scene_floor') {
        node.visible = val;
      }
    });
    requestRender();
  });

  if (meshCount <= 300) {
    buildGuiTree(sceneGraphFolder, model, model);
  } else {
    console.warn(`Model has too many meshes (${meshCount}). Detailed tree view disabled.`);
  }
}

function buildGuiTree(parentFolder, node, rootModel) {
  const childrenWithMeshes = node.children.filter(c => {
    let hasMesh = false;
    c.traverse(n => { if (n.isMesh) hasMesh = true; });
    return hasMesh;
  });

  if (childrenWithMeshes.length === 0) return;

  let currentFolder = parentFolder;
  if (node !== rootModel && childrenWithMeshes.length > 0) {
    const folderName = node.name || `Group_${node.id}`;
    currentFolder = parentFolder.addFolder(folderName);
  }

  childrenWithMeshes.forEach(child => {
    if (child.isMesh) {
      const guiLabel = (child.name || 'Mesh') + `[${child.id}]`;

      currentFolder.add(child, 'visible').name(guiLabel).onChange(() => {
        requestRender();
      }).listen();
    } else {
      buildGuiTree(currentFolder, child, rootModel);
    }
  });
}

//#endregion
