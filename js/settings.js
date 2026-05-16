'use strict';

//! ***************  3D SCENE SETTINGS ***************

export const GUI_MODE_LIGHTING = true;
export const DEV_MODE_HELPERS = false;

export const MODEL_CENTER_POSITION = 0;
export const START_CAMERA_POSITION = [0.005, 0.428, 1.213];
export const ADD_FLOOR = true;

export const CONTROL_TARGET_POSITION_Y = 0;
export const CONTROLS_ENABLE_PAN = true;
export const CONTROLS_FIX_VERTICAL_PAN = false; // фіксує панування по вертикалі

export const BACKGROUND_COLOR = 0xffffff; // 0xffffff (default);
export const SHADOW_TRANSPARENCY = 0.125;
export const TONE_MAPPING_EXPOSURE = 1.0; // 1.0 (default)

export const ENVIRONMENT_MAP = '/environment/neutral.hdr'; // neutral.hdr (default)
export const ENVIRONMENT_MAP_INTENSITY = 1.2;  //  1.0  (default)
export const ENVIRONMENT_MAP_FLIP_X = false;   // false (default)
export const ENVIRONMENT_MAP_ROTATEBLE = true; // false (default)
export const ENVIRONMENT_MAP_ANGLE = 0;        //   0   (default)

export const ADD_DIRLIGHT = true;
export const DIRLIGHT_INTENSITY = 0.9;
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
    path: '/public/models/carrom-draco.glb',
    model: null,
  }
};
