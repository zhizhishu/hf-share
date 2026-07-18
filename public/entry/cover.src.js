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

const ASSET_BASE = "/entry/assets"

function $(id) { return document.getElementById(id) }

function boot() {
  const root = $("cover-root")
  const canvas = $("cover-canvas")
  const loader = $("cover-loader")
  const barFill = $("cover-bar-fill")
  const statusEl = $("cover-status")
  if (!root || !canvas) return

  // 三个入口锚点(3D 世界坐标 → 每帧投影成屏幕热点)。中=水晶(cloudspace),
  // 左海=email, 右海=fusion。点击 → 视觉离场动效 + 跳各自服务(各自原生登录)。
  const ENTRIES = [
    { key: "email",  el: $("hotspot-email"),  world: new THREE.Vector3(-48, 3.2, -46), top: 7,  href: (window.__ENTRY_EMAIL__  || "/email/") },
    { key: "cloud",  el: $("hotspot-cloud"),  world: new THREE.Vector3(0, 9, -52),     top: 13, href: (window.__ENTRY_CLOUD__  || "/cloud/") },
    { key: "fusion", el: $("hotspot-fusion"), world: new THREE.Vector3(48, 3.2, -46),  top: 7,  href: (window.__ENTRY_FUSION__ || "/admin") },
  ]
  let leaving = false

  let motionOn = true
  let entered = false

  // ---- 三入口点击 → 视觉离场 + 跳转(各服务原生登录,前端不存/不传密码) ----
  function goEntry(href) {
    if (leaving || !href) return
    leaving = true
    root.classList.add("is-leaving")
    setTimeout(() => { window.location.href = href }, 460)
  }
  ENTRIES.forEach((en) => {
    if (en.el) en.el.addEventListener("click", (e) => { e.preventDefault(); goEntry(en.href) })
  })
  // 顶部"解锁"按钮 / logo / hero CTA 等辅助入口:默认导向中间(cloudspace)。
  document.querySelectorAll("[data-cover-open]").forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); goEntry(ENTRIES[1].href) })
  })

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

  // ---- 手机端视差:陀螺仪(deviceorientation)驱动同一个 target,倾斜手机即视差 ----
  // 首帧作基准,之后按"相对基准"的倾角算 → 与握持角度无关;/24 满量程,微倾即动。
  let tiltBase = null
  const onTilt = (e) => {
    if (e == null || (e.gamma == null && e.beta == null)) return
    if (!tiltBase) tiltBase = { g: e.gamma || 0, b: e.beta || 0 }
    target.x = Math.max(-0.5, Math.min(0.5, ((e.gamma || 0) - tiltBase.g) / 24))
    target.y = Math.max(-0.5, Math.min(0.5, ((e.beta || 0) - tiltBase.b) / 24))
  }
  window.addEventListener("deviceorientation", onTilt)
  // iOS 13+ 需在用户手势里申请陀螺仪权限;首次任意交互(touchstart/pointerdown/click)都试一次。
  let tiltAsked = false
  const enableTilt = () => {
    if (tiltAsked) return
    tiltAsked = true
    try {
      const D = window.DeviceOrientationEvent
      if (D && typeof D.requestPermission === "function") {
        D.requestPermission().then((s) => { if (s === "granted") window.addEventListener("deviceorientation", onTilt) }).catch(() => {})
      }
    } catch (_) {}
  }
  ;["touchstart", "pointerdown", "click"].forEach((ev) => window.addEventListener(ev, enableTilt, { passive: true }))

  const resize = () => {
    w = window.innerWidth; h = window.innerHeight
    renderer.setSize(w, h, false); composer.setSize(w, h)
    // 手机竖屏适配:窄视口下左右海锚点(x=±48)会飞出侧边 —— 竖屏时拉远相机 + 加宽 FOV +
    // 收窄左右海间距,让"左海/中央/右海"三处都进画且够得着;横屏/桌面维持原构图。
    const portrait = h > w
    camera.fov = portrait ? 76 : 55
    HERO_POS.set(0, portrait ? 9.5 : 8.5, portrait ? 40 : 24)
    const spread = portrait ? 26 : 48
    ENTRIES[0].world.x = -spread; ENTRIES[2].world.x = spread
    camera.aspect = w / h; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener("resize", resize)

  // ---- 三热点:每帧把三个锚点世界坐标投影到屏幕,盖透明可点圆(不靠几何 raycast) ----
  const _proj = new THREE.Vector3(), _projTop = new THREE.Vector3()
  function updateHotspots() {
    const show = entered && !leaving
    for (const en of ENTRIES) {
      if (!en.el) continue
      if (!show) { en.el.style.opacity = "0"; en.el.style.pointerEvents = "none"; continue }
      _proj.copy(en.world).project(camera)
      _projTop.set(en.world.x, en.world.y + en.top, en.world.z).project(camera)
      if (_proj.z > 1) { en.el.style.opacity = "0"; en.el.style.pointerEvents = "none"; continue }
      const sx = (_proj.x * 0.5 + 0.5) * w
      const sy = (-_proj.y * 0.5 + 0.5) * h
      const ty = (-_projTop.y * 0.5 + 0.5) * h
      const r = Math.max(46, Math.abs(sy - ty) + 20)
      en.el.style.width = en.el.style.height = `${Math.round(r * 2)}px`
      en.el.style.left = `${Math.round(sx)}px`
      en.el.style.top = `${Math.round(sy)}px`
      en.el.style.opacity = "1"
      en.el.style.pointerEvents = "auto"
    }
  }

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
        gem.rotation.y = gemSpin + cur.x * 1.05
        gem.rotation.x = cur.y * 0.62
        const floatY = Math.sin(elapsed * 0.6) * 0.9
        gem.position.y = gemBaseY + floatY
        ENTRIES[1].world.y = GEM_Y + floatY  // 中间水晶锚点跟着上下浮动
      }
      cur.x += (target.x - cur.x) * 0.04; cur.y += (target.y - cur.y) * 0.04
    }
    if (entered) dollyT = Math.min(1, dollyT + dt / 2.4)
    const e = 1 - Math.pow(1 - dollyT, 3)
    tmpPos.lerpVectors(FAR_POS, HERO_POS, e)
    tmpPos.x += cur.x * 16 * e; tmpPos.y += -cur.y * 9 * e
    camera.position.copy(tmpPos)
    tmpLook.lerpVectors(FAR_LOOK, HERO_LOOK, e)
    camera.lookAt(tmpLook)
    updateHotspots()
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
