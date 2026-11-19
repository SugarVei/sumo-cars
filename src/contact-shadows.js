import * as THREE from 'three';

/** One soft footprint per car, projected onto its measured contact plane. */
export function createContactShadows(scene,cars){
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 vUv;
      void main(){vec2 p=abs(vUv-.5)*2.;float d=pow(pow(p.x,3.)+pow(p.y,3.),1./3.);
        gl_FragColor=vec4(.016,.011,.024,.34*(1.-smoothstep(.2,1.,d)));}`,
  });
  const geometry=new THREE.PlaneGeometry(1,1);
  geometry.rotateX(-Math.PI/2);
  const mesh=new THREE.InstancedMesh(geometry,material,cars.length);
  mesh.name='Contact shadows';mesh.frustumCulled=false;mesh.renderOrder=1;scene.add(mesh);
  const pose=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3();
  return {update(visible){
    mesh.visible=visible;if(!visible)return;
    let n=0;
    for(const car of cars){
      if(!car.active||!car.ray.hasHit||car.onCar)continue;
      const ground=car.ray.hitPointWorld;
      normal.copy(car.ray.hitNormalWorld);
      if(normal.y<.45)continue;
      const fade=Math.max(0,Math.min(1,(1.35-car.ray.distance)/.5));
      pose.position.copy(ground).addScaledVector(normal,.016);
      pose.quaternion.setFromUnitVectors(up,normal);
      pose.rotateY(Math.atan2(-car.forward.x,-car.forward.z));
      pose.scale.set(2.65*fade,1,4.15*fade);pose.updateMatrix();mesh.setMatrixAt(n++,pose.matrix);
    }
    mesh.count=n;mesh.instanceMatrix.needsUpdate=true;
  }};
}
