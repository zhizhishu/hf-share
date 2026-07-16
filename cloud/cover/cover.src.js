/*
 * CloudSpace pre-login ocean cover — vanilla port of vertex/ocean-landing.tsx.
 * Framework-free; bundled to cover.bundle.js (IIFE) via esbuild.
 *
 * Faithful to the original: glowing crystal (real intro_compressed.glb) floating
 * over a Three.js Water ocean, mouse-tracked, revealed by a camera dolly after the
 * loading gate, with an UnrealBloom glow. Rebranded to CloudSpace.
 *
 * Interaction: clicking the crystal (a screen-projected transparent hotspot over the
 * glb, so it is robust regardless of geometry) gracefully reveals the password panel.
 * The panel's <form> is a real POST to /__lock/login (see login.html); submit is a
 * native form submit, never fetch.
 *
 * All asset URLs are absolute /cover/assets/... so they resolve no matter what path
 * the gateway serves login.html from (it is served at /__lock/login).
 */
import * as THREE from "three"
import { Water } from "three/examples/jsm/objects/Water.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"

const ASSET_BASE = "/cover/assets"

function $(id) { return document.getElementById(id) }

function boot() {
  const root = $("cover-root")
  const canvas = $("cover-canvas")
  const loader = $("cover-loader")
  const barFill = $("cover-bar-fill")
  const statusEl = $("cover-status")
  const hotspot = $("cover-hotspot")
  const panel = $("cover-panel")
  const errorEl = $("cover-error")
  const passwordInput = $("cover-password")
  if (!root || !canvas) return

  let motionOn = true
  let entered = false

  // ---- panel open/close wiring ----
  function openPanel() {
    if (panel.classList.contains("is-open")) return
    panel.classList.add("is-open")
    root.classList.add("is-panel-open")
    setTimeout(() => { try { passwordInput && passwordInput.focus() } catch (_) {} }, 360)
  }
  function closePanel() {
    panel.classList.remove("is-open")
    root.classList.remove("is-panel-open")
  }
  document.querySelectorAll("[data-cover-open]").forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); openPanel() })
  })
  document.querySelectorAll("[data-cover-close]").forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); closePanel() })
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel()
  })
  // If the gateway injected an error message, surface the panel immediately so the
  // user can retry without hunting for the crystal again.
  if (errorEl && errorEl.textContent && errorEl.textContent.trim().length > 0) {
    root.classList.add("is-entered"); entered = true
    openPanel()
  }

  // ---- WebGL scene ----
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" })
  } catch (err) {
    // No WebGL — degrade to a static gradient and make sure the form is reachable.
    console.warn("[cover] WebGL unavailable, falling back to static cover", err)
    root.classList.add("is-entered", "no-webgl")
    if (loader) loader.classList.add("is-done")
    if (hotspot) hotspot.style.display = "none"
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.66

  const scene = new THREE.Scene()
  // vertical gradient sky baked into a canvas texture (same palette as vertex)
  const grad = document.createElement("canvas")
  grad.width = 4; grad.height = 256
  const gx = grad.getContext("2d")
  const lg = gx.createLinearGradient(0, 0, 0, 256)
  lg.addColorStop(0, "#1d2733"); lg.addColorStop(0.58, "#33455a"); lg.addColorStop(1, "#46596d")
  gx.fillStyle = lg; gx.fillRect(0, 0, 4, 256)
  const bgTex = new THREE.CanvasTexture(grad); bgTex.colorSpace = THREE.SRGBColorSpace
  scene.background = bgTex
  scene.fog = new THREE.FogExp2(0x3a4c61, 0.0085)

  const camera = new THREE.PerspectiveCamera(55, 1, 1, 8000)
  const FAR_POS = new THREE.Vector3(0, 20, 110), HERO_POS = new THREE.Vector3(0, 8.5, 24)
  const FAR_LOOK = new THREE.Vector3(0, 10, -52), HERO_LOOK = new THREE.Vector3(0, 9, -52)
  camera.position.copy(FAR_POS)

  // ---- ocean ----
  const manager = new THREE.LoadingManager()
  manager.onProgress = (_u, l, t) => setProgress(t ? l / t : 1)
  const waterGeo = new THREE.PlaneGeometry(10000, 10000)
  const water = new Water(waterGeo, {
    textureWidth: 1024, textureHeight: 1024,
    waterNormals: new THREE.TextureLoader(manager).load(`${ASSET_BASE}/waternormals.jpg`, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping }),
    sunDirection: new THREE.Vector3(), sunColor: 0x90a8c4, waterColor: 0x0a1622, distortionScale: 7.0, fog: true,
  })
  water.rotation.x = -Math.PI / 2
  water.material.uniforms.size.value = 5.2
  scene.add(water)

  const sun = new THREE.Vector3()
  sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(205))
  water.material.uniforms.sunDirection.value.copy(sun).normalize()
  scene.add(new THREE.HemisphereLight(0x9bb8e1, 0x05080f, 0.7))
  const keyLight = new THREE.DirectionalLight(0xdbe2ea, 1.6); keyLight.position.set(6, 12, 9); scene.add(keyLight)
  const rimLight = new THREE.DirectionalLight(0x5a636e, 0.9); rimLight.position.set(-9, 5, -7); scene.add(rimLight)

  // ---- crystal (the gem) ----
  const GEM_Y = 9
  let gem = null
  let gemBaseY = GEM_Y
  let gemSpin = 0
  const gemCenter = new THREE.Vector3(0, GEM_Y, -52) // visual center for the click hotspot
  const draco = new DRACOLoader(); draco.setDecoderPath(`${ASSET_BASE}/draco/`)
  const ktx2 = new KTX2Loader().setTranscoderPath(`${ASSET_BASE}/basis/`).detectSupport(renderer)
  const gltf = new GLTFLoader(manager); gltf.setDRACOLoader(draco); gltf.setKTX2Loader(ktx2)
  gltf.load(`${ASSET_BASE}/intro_compressed.glb`, (g) => {
    const grp = g.scene
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xeaf1f7, roughness: 0.1, metalness: 0, transmission: 0.82, thickness: 3,
      ior: 1.35, emissive: 0xbcd2e6, emissiveIntensity: 0.5, transparent: true, opacity: 0.86, side: THREE.DoubleSide,
    })
    const veinMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
    grp.traverse((o) => {
      if (o.isMesh) {
        o.material = bodyMat
        o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 16), veinMat))
      }
    })
    const box = new THREE.Box3().setFromObject(grp); const size = new THREE.Vector3(); box.getSize(size)
    grp.scale.setScalar(30 / (size.y || 1))
    const box2 = new THREE.Box3().setFromObject(grp); const center = new THREE.Vector3(); box2.getCenter(center)
    gemBaseY = GEM_Y - center.y
    grp.position.set(-center.x, gemBaseY, -52 - center.z)
    scene.add(grp); gem = grp
    const core = new THREE.PointLight(0xeaf6ff, 2.4, 170); core.position.set(0, GEM_Y, -52); scene.add(core)
  }, undefined, (err) => { console.error("[cover] gem load failed", err) })

  // ---- bloom (the glow) ----
  let w = window.innerWidth, h = window.innerHeight
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.15, 0.6, 0.62)
  composer.addPass(bloom)

  // ---- mouse tracking ----
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 }
  const onMove = (e) => { target.x = e.clientX / window.innerWidth - 0.5; target.y = e.clientY / window.innerHeight - 0.5 }
  window.addEventListener("pointermove", onMove)

  const resize = () => {
    w = window.innerWidth; h = window.innerHeight
    renderer.setSize(w, h, false); composer.setSize(w, h)
    camera.aspect = w / h; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener("resize", resize)

  // ---- crystal hotspot: project the gem center to screen and keep an invisible,
  //      clickable circle on top of it (robust vs. raycasting thin/transparent glass) ----
  const projTop = new THREE.Vector3()
  function updateHotspot() {
    if (!hotspot) return
    if (!entered || panel.classList.contains("is-open")) { hotspot.style.opacity = "0"; hotspot.style.pointerEvents = "none"; return }
    const c = gemCenter.clone().project(camera)
    const t = projTop.set(gemCenter.x, gemCenter.y + 13, gemCenter.z).project(camera)
    if (c.z > 1) { hotspot.style.opacity = "0"; hotspot.style.pointerEvents = "none"; return } // behind camera
    const sx = (c.x * 0.5 + 0.5) * w
    const sy = (-c.y * 0.5 + 0.5) * h
    const ty = (-t.y * 0.5 + 0.5) * h
    const r = Math.max(54, Math.abs(sy - ty) + 26)
    hotspot.style.width = hotspot.style.height = `${Math.round(r * 2)}px`
    hotspot.style.left = `${Math.round(sx)}px`
    hotspot.style.top = `${Math.round(sy)}px`
    hotspot.style.opacity = "1"
    hotspot.style.pointerEvents = "auto"
  }
  if (hotspot) hotspot.addEventListener("click", (e) => { e.preventDefault(); openPanel() })

  // ---- animation loop ----
  const clock = new THREE.Clock()
  let elapsed = 0, dollyT = 0
  const tmpPos = new THREE.Vector3(), tmpLook = new THREE.Vector3()
  let raf = 0
  const animate = () => {
    raf = requestAnimationFrame(animate)
    const dt = clock.getDelta()
    if (motionOn) {
      elapsed += dt
      water.material.uniforms.time.value += dt * 0.5
      if (gem) {
        gemSpin += dt * 0.1
        gem.rotation.y = gemSpin + cur.x * 0.7
        gem.rotation.x = cur.y * 0.45
        const floatY = Math.sin(elapsed * 0.6) * 0.9
        gem.position.y = gemBaseY + floatY
        gemCenter.y = GEM_Y + floatY
      }
      cur.x += (target.x - cur.x) * 0.04; cur.y += (target.y - cur.y) * 0.04
    }
    if (entered) dollyT = Math.min(1, dollyT + dt / 2.4)
    const e = 1 - Math.pow(1 - dollyT, 3)
    tmpPos.lerpVectors(FAR_POS, HERO_POS, e)
    tmpPos.x += cur.x * 7 * e; tmpPos.y += -cur.y * 4 * e
    camera.position.copy(tmpPos)
    tmpLook.lerpVectors(FAR_LOOK, HERO_LOOK, e)
    camera.lookAt(tmpLook)
    updateHotspot()
    composer.render()
  }
  animate()

  // ---- loading gate ----
  function setProgress(p) {
    const v = Math.max(0, Math.min(1, p))
    if (barFill) barFill.style.transform = `scaleX(${v})`
    if (statusEl) statusEl.textContent = v >= 1 ? "READY" : "LOADING"
  }
  let safety = window.setTimeout(finish, 4200)
  let finished = false
  function finish() {
    if (finished) return
    finished = true
    window.clearTimeout(safety)
    setProgress(1)
    if (loader) loader.classList.add("is-done")
    window.setTimeout(() => {
      entered = true
      root.classList.add("is-entered")
    }, 600)
  }
  manager.onLoad = finish

  // ---- motion toggle (optional flourish from vertex) ----
  const motionBtn = $("cover-motion")
  if (motionBtn) {
    motionBtn.addEventListener("click", () => {
      motionOn = !motionOn
      motionBtn.setAttribute("aria-pressed", String(motionOn))
      const b = motionBtn.querySelector("b")
      if (b) b.textContent = motionOn ? "ON" : "OFF"
    })
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot)
} else {
  boot()
}
