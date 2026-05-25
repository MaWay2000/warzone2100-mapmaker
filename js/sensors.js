export let SENSOR_DEFS = {};

export async function loadSensorDefs() {
  try {
    const url = (typeof window !== 'undefined' && window.SENSORS_JSON) ? window.SENSORS_JSON : 'sensor.json';
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    SENSOR_DEFS = data;
  } catch (err) {
    console.error('Failed to load sensor definitions:', err);
  }
}

export function getSensorModels(sensorID) {
  const sensor = SENSOR_DEFS[sensorID];
  if (!sensor) return [];
  const models = [];
  if (sensor.sensorModel) models.push(sensor.sensorModel.toLowerCase());
  if (sensor.mountModel) models.push(sensor.mountModel.toLowerCase());
  return models;
}
