// camera.js

export const cameraState = {
  camTargetX: 0,
  camTargetZ: 0,
  // Do not rotate the map by default so it aligns with the screen axes
  rotationY: 0,
  rotationX: -1.1,
  zoom: 0.8,
  camMoveSpeed: 5,
  keys: {}
};

export function resetCameraTarget(mapW, mapH, container) {
  cameraState.camTargetX = (mapW / 2 - 0.5);
  cameraState.camTargetZ = (mapH / 2 - 0.5);
  // Reset orientation without rotating the map around the vertical axis
  cameraState.rotationY = 0;
  cameraState.rotationX = -1.1;
  // Position the camera so that the map roughly fits the viewport.
  // In `game.js` the camera distance is computed as:
  //   dist = max(mapW, mapH) * 1.5 * cameraState.zoom
  // and the horizontal distance from the camera to the target on the
  // ground plane is `cos(rotationX) * dist`.  To have the map fill the
  // view we choose a zoom that makes this horizontal distance about half
  // the largest map dimension, leaving a small margin.
  const margin = 1.05; // extra space around the edges
  cameraState.zoom = margin / (3 * Math.cos(cameraState.rotationX));
}

export function setupKeyboard(resetCallback) {
  window.addEventListener('keydown', e => {
    cameraState.keys[e.key.toLowerCase()] = true;
    if (e.key.startsWith('Arrow')) e.preventDefault();
    if (e.key.toLowerCase() === 'r') resetCallback();
  });
  window.addEventListener('keyup', e => {
    cameraState.keys[e.key.toLowerCase()] = false;
    if (e.key.startsWith('Arrow')) e.preventDefault();
  });
}
