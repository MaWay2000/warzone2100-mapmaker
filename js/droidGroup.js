import * as THREE from "./three.module.js";
import { loadPieGeometry } from "./pie.js";

function normalizeTexPath(name) {
  let n = String(name || "").replace(/\\/g, "/").toLowerCase();
  n = n.replace(/^\.+\//, "");
  n = n.replace(/^(images|texpages)\//, "");
  n = n.replace(/^classic\/texpages\//, "");
  n = n.replace(/texpages\/texpages\//g, "texpages/");
  return n;
}

export async function buildDroidGroup(pieFiles) {
  const group = new THREE.Group();
  const geos = await Promise.all(
    pieFiles.map(f => loadPieGeometry(f).then(g => g.clone()).catch(() => null))
  );
  geos.forEach(geo => {
    if (!geo) return;
    geo.computeBoundingBox();
    let mat;
    if (geo.userData && geo.userData.textureName) {
      const tl = new THREE.TextureLoader();
      const tn = normalizeTexPath(geo.userData.textureName);
      const tex = tl.load(((typeof window!=='undefined'&&window.TEX_BASE)?window.TEX_BASE:TEX_BASE) + tn, undefined, undefined, () => {});
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipMapLinearFilter;
      mat = new THREE.MeshLambertMaterial({ map: tex });
    } else {
      mat = new THREE.MeshLambertMaterial({ color: 0x8888ff });
    }
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
  });
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  group.userData.minY = bbox.min.y;
  const center = bbox.getCenter(new THREE.Vector3());
  group.userData.centerX = center.x;
  group.userData.centerY = center.y;
  group.userData.centerZ = center.z;
  const sphere = new THREE.Sphere();
  bbox.getBoundingSphere(sphere);
  group.userData.boundingSphere = sphere;
  group.userData.cullable = true;
  return group;
}
