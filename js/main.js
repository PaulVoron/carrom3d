import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { create3DScene, loadModel, scene } from './3d-scene.js';

let world;
let physicsBodies = []; // Массив объектов: { mesh, body }
let pocketColliders = []; // Массив колайдеров луз

// Очередь для обработки падения фишек в лузу
const fallingQueue = new Map();

async function init() {
  await RAPIER.init();
  
  // Гравитация
  const gravity = { x: 0.0, y: -9.81, z: 0.0 };
  world = new RAPIER.World(gravity);

  // Инициализируем визуальную сцену
  await create3DScene(updatePhysics);

  // Загружаем нашу идеальную модель
  const model = await loadModel('/models/carrom-draco.glb');
  if (!model) return;

  setupPhysics(model);
  setupPockets();
}

// Главный цикл синхронизации физики и рендера
function updatePhysics() {
  if (!world) return;

  world.step();
  checkPocketIntersections();

  const currentTime = performance.now();

  physicsBodies.forEach((entry) => {
    const { mesh, body } = entry; 

    // Логика задержки (чтобы игрок увидел, как фишка проваливается в лузу)
    if (fallingQueue.has(body.handle)) {
      const fallStartTime = fallingQueue.get(body.handle);
      if (currentTime - fallStartTime > 250) {
        processPocketResult(entry);
        fallingQueue.delete(body.handle);
      }
    }

    // Если тело активно, копируем координаты из физики в визуал
    if (body.isEnabled()) {
      const position = body.translation();
      const rotation = body.rotation();

      mesh.position.set(position.x, position.y, position.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  });
}

function checkPocketIntersections() {
  pocketColliders.forEach((pocketCollider) => {
    world.intersectionsWith(pocketCollider, (hitHandle) => {
      const bodyEntry = physicsBodies.find(b => b.body.handle === hitHandle);
      if (bodyEntry && !fallingQueue.has(hitHandle)) {
        fallingQueue.set(hitHandle, performance.now());
      }
      return true;
    });
  });
}

function setupPockets() {
  const halfSize = 0.735 / 2;
  const pocketRadius = 0.0445 / 2;
  const offset = halfSize - pocketRadius;

  const pocketPositions = [
    { x: offset, z: offset },
    { x: offset, z: -offset },
    { x: -offset, z: offset },
    { x: -offset, z: -offset }
  ];

  pocketPositions.forEach((pos) => {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos.x, -0.02, pos.z);
    const body = world.createRigidBody(bodyDesc);
    
    const colliderDesc = RAPIER.ColliderDesc.cylinder(0.01, pocketRadius).setSensor(true);
    const collider = world.createCollider(colliderDesc, body);
    pocketColliders.push(collider);
  });
}

function processPocketResult(entry) {
  const { mesh, body } = entry;
  body.setLinearVelocity({ x: 0, y: 0, z: 0 }, true);
  body.sleep();
  body.setEnabled(false);
  mesh.visible = false;

  if (window.onPocketEnter) {
    window.onPocketEnter(mesh.userData.type, mesh.userData.id);
  }
}

// Главная функция настройки сцены
function setupPhysics(model) {
  const positions = new Array(19).fill(null);
  let strikerMesh = null;
  let coinTemplate = null;
  let boardTopY = 0; // Истинная математическая высота поверхности стола

  model.updateMatrixWorld(true);

  model.traverse((obj) => {
    // Борта (Trimesh для правильного отскока)
    if (obj.name === 'mesh_board_frame') {
      createTrimeshBody(obj);
    }
    
    // Поверхность стола (Идеально гладкий физический куб)
    if (obj.name === 'mesh_board_surface') {
      // 1. Измеряем точную высоту верхней грани деревянной текстуры
      boardTopY = 0.002;

      const floorHalfHeight = 0.05; // Половина толщины пола (10см)
      const floorCenterY = boardTopY - floorHalfHeight; // Верхняя грань куба будет СТРОГО на boardTopY
      
      const floorBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorCenterY, 0);
      const floorBody = world.createRigidBody(floorBodyDesc);
      
      const floorColliderDesc = RAPIER.ColliderDesc.cuboid(2.0, floorHalfHeight, 2.0)
        .setFriction(0.1)     // Очень низкое трение (имитация пудры)
        .setRestitution(0.1); // Гасим отскок от пола
      world.createCollider(floorColliderDesc, floorBody);
    }

    if (obj.name === 'mesh_carrom_man') {
      coinTemplate = obj;
      obj.visible = false;
    }
    if (obj.name.startsWith('pos_coin_')) {
      const index = parseInt(obj.name.replace('pos_coin_', ''));
      positions[index] = obj.getWorldPosition(new THREE.Vector3());
      obj.visible = false;
    }
    if (obj.name === 'mesh_striker') {
      strikerMesh = obj;
    }
  });

  // === ЖЕСТКАЯ НОРМАЛИЗАЦИЯ ФИШЕК ===
  const officialCoinDia = 0.0318; 
  const officialCoinHalfHeight = 0.008 / 2; // Толщина 8 мм

  if (coinTemplate) {
    // Вытаскиваем фишку в корень сцены (отвязываем от групп Блендера)
    scene.add(coinTemplate); 
    coinTemplate.scale.set(1, 1, 1);
    coinTemplate.updateMatrixWorld(true);
    
    // Измеряем и масштабируем до идеальных размеров
    const bbox = new THREE.Box3().setFromObject(coinTemplate);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    
    coinTemplate.scale.set(
      officialCoinDia / size.x,
      (officialCoinHalfHeight * 2) / size.y,
      officialCoinDia / size.z
    );
    coinTemplate.updateMatrixWorld(true);

    const boardCenter = positions[0] ? positions[0].clone() : new THREE.Vector3(0, 0, 0);
    // Точка отсчета для сетки — истинная поверхность стола
    boardCenter.y = boardTopY; 

    // 45 градусов в радианах (Math.PI / 4)
    const rotation45 = -Math.PI / 4;
    const perfectPositions = getCarromPositions(boardCenter, officialCoinDia, rotation45);

    for (let i = 0; i < 19; i++) {
      const coinClone = coinTemplate.clone();
      coinClone.visible = true;
      scene.add(coinClone); 

      coinClone.userData.id = i;
      if (i === 0) {
        coinClone.userData.type = 'queen';
        setMeshColor(coinClone, 0xff0000);
      } else {
        const isWhite = i % 2 === 0;
        coinClone.userData.type = isWhite ? 'white' : 'black';
        setMeshColor(coinClone, isWhite ? 0xbbbbbb : 0x444444);
      }

      const spawnPos = perfectPositions[i];
      // Origin в центре геометрии, значит центр фишки должен быть на halfHeight выше стола
      spawnPos.y = boardTopY + officialCoinHalfHeight + 0.002; 
      
      const physRadius = (officialCoinDia / 2) * 0.98; // Зазор для стабильности
      const body = createSimplePhysicsBody(physRadius, officialCoinHalfHeight, spawnPos);
      
      physicsBodies.push({ mesh: coinClone, body });
    }
  }

  // === ЖЕСТКАЯ НОРМАЛИЗАЦИЯ БИТКА ===
  if (strikerMesh) {
    const officialStrikerDia = 0.0413;
    const officialStrikerHalfHeight = 0.008 / 2;

    scene.add(strikerMesh);
    strikerMesh.scale.set(1, 1, 1);
    strikerMesh.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(strikerMesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    
    strikerMesh.scale.set(
      officialStrikerDia / size.x,
      (officialStrikerHalfHeight * 2) / size.y,
      officialStrikerDia / size.z
    );
    strikerMesh.updateMatrixWorld(true);

    strikerMesh.userData.id = 999;
    strikerMesh.userData.type = 'striker';

    const spawnPos = positions[0] ? positions[0].clone() : new THREE.Vector3(0, 0, 0);
    spawnPos.y = boardTopY + officialStrikerHalfHeight + 0.002;
    spawnPos.z += 0.25; // Сдвигаем в сторону для теста

    const physRadius = (officialStrikerDia / 2) * 0.98;
    const body = createSimplePhysicsBody(physRadius, officialStrikerHalfHeight, spawnPos);
    
    physicsBodies.push({ mesh: strikerMesh, body });
  }
}

// --- ФИЗИЧЕСКИЕ ХЕЛПЕРЫ ---

function createTrimeshBody(mesh) {
  const geometry = mesh.geometry.clone();
  mesh.updateMatrixWorld(true);
  geometry.applyMatrix4(mesh.matrixWorld);

  const vertices = new Float32Array(geometry.attributes.position.array);
  let indices = null;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array);
  }

  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
    .setFriction(0.1)     // Борта скользкие
    .setRestitution(0.5); // Хороший отскок фишек от бортов

  world.createCollider(colliderDesc, body);
  return body;
}

function createSimplePhysicsBody(radius, halfHeight, spawnPosition) {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
    .setCcdEnabled(true)     // Защита от проваливания сквозь стол
    .setLinearDamping(4.0)   // Мгновенная остановка (имитация трения)
    .setAngularDamping(4.0); 

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
    .setFriction(0.6)
    .setRestitution(0.1); 

  world.createCollider(colliderDesc, body);
  return body;
}

// --- УТИЛИТЫ ---

function setMeshColor(obj, colorValue) {
  obj.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.color.set(colorValue);
    }
  });
}

window.onPocketEnter = (type, id) => {
  console.log(`🎯 Rules Engine: Объект типа ${type} (ID: ${id}) в лузе!`);
};

// Генерация идеального узора (шестиугольник)
function getCarromPositions(centerPos, diameter, rotationAngle = 0) {
  const gap = 0.0002; // Наш идеальный микро-зазор
  const d = diameter + gap;
  const positions = [];

  // 0: Центр (Королева)
  positions.push(new THREE.Vector3(centerPos.x, centerPos.y, centerPos.z));

  // 1-6: Внутреннее кольцо (шаг 60 градусов)
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + rotationAngle;
    positions.push(new THREE.Vector3(
      centerPos.x + Math.cos(angle) * d, 
      centerPos.y, 
      centerPos.z + Math.sin(angle) * d
    ));
  }

  // 7-18: Внешнее кольцо (12 фишек, шаг 30 градусов)
  // Идем строго по часовой/против часовой стрелки, поэтому цвета будут чередоваться 1 через 1
  const dSq3 = d * Math.sqrt(3);
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6 + rotationAngle;
    
    // Если четный шаг — это угол гексагона (дальше от центра). Нечетный — центр грани (ближе).
    const dist = (i % 2 === 0) ? (2 * d) : dSq3;

    positions.push(new THREE.Vector3(
      centerPos.x + Math.cos(angle) * dist, 
      centerPos.y, 
      centerPos.z + Math.sin(angle) * dist
    ));
  }
  
  return positions;
}

init();
