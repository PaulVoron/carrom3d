'use strict';

//! ***************  3D SCENE SETTINGS ***************

export const GUI_MODE_LIGHTING = false;
export const DEV_MODE_HELPERS = false;
export const DEBUG_MODE = false; // Визуальный дебаг физических коллизий и триггерных зон луз

export const MODEL_CENTER_POSITION = 0;
export const START_CAMERA_POSITION = [0.000, 0.65, 1.12];
export const ADD_FLOOR = false;

export const CONTROL_TARGET_POSITION_Y = 0;
export const CONTROLS_ENABLE_PAN = true;
export const CONTROLS_FIX_VERTICAL_PAN = false; // фіксує панування по вертикалі

export const SET_BACKGROUND = false; // true — использовать сплошной цвет BACKGROUND_COLOR, false — сделать WebGL прозрачным для CSS-фона
export const BACKGROUND_COLOR = 0x656565; // 0xffffff (default);
export const SHADOW_TRANSPARENCY = 0.08125;
export const TONE_MAPPING_EXPOSURE = 1.0; // 1.0 (default)

export const ENVIRONMENT_MAP = '/environment/brown_photostudio_07_1k.hdr'; // neutral.hdr (default)
export const ENVIRONMENT_MAP_INTENSITY = 1.3;  //  1.0  (default)
export const ENVIRONMENT_MAP_FLIP_X = false;   // false (default)
export const ENVIRONMENT_MAP_ROTATEBLE = true; // false (default)
export const ENVIRONMENT_MAP_ANGLE = 180;       //   0   (default)

export const ENVIRONMENT_AS_BACKGROUND = false; // true (за замовчуванням), щоб фон відображався позаду сцени
export const ENVIRONMENT_BACKGROUND_INTENSITY = 0.7; // Зменшена інтенсивність фону, щоб він був менш нав'язливим
export const ENVIRONMENT_BACKGROUND_BLURRINESS = 0.2; // Легке розмиття для ефекту боке

export const ADD_DIRLIGHT = true;
export const DIRLIGHT_INTENSITY = 1.0;
export const DIRLIGHT_INTENSITY_ANDROID = 0.9;

export const ADD_POINTLIGHT = false; // false (default)
export const POINTLIGHT_INTENSITY = 0.5;

export const ADD_AMBIENTLIGHT = false; // false (default)
export const AMBIENTLIGHT_INTENSITY = 0;
export const AMBIENTLIGHT_INTENSITY_ANDROID = 8;

export const RENDER_SCALE = 1;

export const FIT_CAMERA_TO_OBJECT = false;

//! ***************  PROJECT SETTINGS ***************

export const ENABLE_ASSEMBLY_ANIMATION = false;

export const MODELS = {
  default: {
    path: '/public/models/carrom2-draco.glb',
    model: null,
  }
};
