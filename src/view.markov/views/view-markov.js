import { runtime, unwrap } from "/core/runtime.js"
import { ViewCanvasBase } from "/util/view-canvas-base.js"
import { VoxelOrbitRenderer } from "/util/voxel-orbit-renderer.js"
import { paletteFromSymbolColors, voxelRenderDataFromIndexedGrid } from "/util/vox/grid.js"
import { compileXmlToMjir, initialGridFromXml, xmlAttr, xmlRootStartTag } from "/util/markov-junior/xml-to-mjir.js"

const PALETTE = {
    // Uppercase A–Z
    A: "#C2C3C7",
    B: "#000000",
    C: "#00FFFF",
    D: "#5F574F",
    E: "#008751",
    F: "#FFCCAA",
    G: "#00E436",
    H: "#E4BB40",
    I: "#1D2B53",
    J: "#4B692F",
    K: "#FF77A8",
    L: "#847E87",
    M: "#FF00FF",
    N: "#AB5236",
    O: "#FFA300",
    P: "#7E2553",
    Q: "#9BADB7",
    R: "#FF004D",
    S: "#83769C",
    T: "#37946E",
    U: "#29ADFF",
    V: "#8F974A",
    W: "#FFF1E8",
    X: "#FF0000",
    Y: "#FFEC27",
    Z: "#FFFFFF",

    // Lowercase a–z
    a: "#A28879",
    b: "#291814",
    c: "#5FCDE4",
    d: "#49333B",
    e: "#125359",
    f: "#FF9D81",
    g: "#00B543",
    h: "#8A6F30",
    i: "#111D35",
    j: "#45107E",
    k: "#FF6E59",
    l: "#696A6A",
    m: "#9C09CC",
    n: "#742F29",
    o: "#FF6C24",
    p: "#422136",
    q: "#3F3F74",
    r: "#BE1250",
    s: "#754665",
    t: "#323C39",
    u: "#065AB5",
    v: "#524B24",
    w: "#F3EF7D",
    x: "#D95763",
    y: "#A8E72E",
    z: "#CBDBFC",

    // Numbers 0–9
    0: "#101820",
    1: "#263238",
    2: "#455A64",
    3: "#607D8B",
    4: "#90A4AE",
    5: "#CFD8DC",
    6: "#F5F5F5",
    7: "#FFE082",
    8: "#FFB300",
    9: "#E65100",
}

function assert(condition, message) {
    if (!condition) throw new Error(message)
}

function normalizePath(path) {
    const raw = String(path || "").trim()
    assert(raw.length > 0, "view-markov path must be non-empty")
    return raw.split("/").filter(Boolean).join("/")
}

function basename(path) {
    return normalizePath(path).split("/").pop()
}

function exampleLabel(example) {
    return example.label || example.name || example.id
}

function exampleDimensionLabel(example) {
    assert(
        example.render === "2d" || example.render === "vox",
        `view-markov unsupported render mode: ${example.render}`,
    )
    return example.render === "vox" ? "3D" : "2D"
}

function exampleSizeLabel(example) {
    assert(
        Number.isInteger(example.width) && example.width > 0,
        `view-markov example ${example.id} width must be a positive integer`,
    )
    assert(
        Number.isInteger(example.height) && example.height > 0,
        `view-markov example ${example.id} height must be a positive integer`,
    )
    assert(
        Number.isInteger(example.depth) && example.depth > 0,
        `view-markov example ${example.id} depth must be a positive integer`,
    )
    return example.depth > 1
        ? `${example.width}×${example.height}×${example.depth}`
        : `${example.width}×${example.height}`
}

function exampleSelectLabel(example) {
    return `${exampleLabel(example)} · ${exampleDimensionLabel(example)} · ${exampleSizeLabel(example)}`
}

function uniqueXmlAttrValues(xml, name) {
    return [...xml.matchAll(new RegExp(`\\b${name}="([^"]+)"`, "g"))].map((match) => match[1])
}

function unique(values) {
    return [...new Set(values)]
}

function wfcStartTagsForTileset(xml, tileset) {
    return [...xml.matchAll(/<wfc\b[^>]*>/g)]
        .map((match) => match[0])
        .filter((tag) => xmlAttr(tag, "tileset", "") === tileset)
}

function tileDirectoriesForTileset(xml, tileset) {
    const tags = wfcStartTagsForTileset(xml, tileset)
    assert(tags.length > 0, `view-markov tileset ${tileset} is not referenced by a tile wfc tag`)
    return unique(tags.map((tag) => xmlAttr(tag, "tiles", tileset)))
}

function joinResourcePath(root, ...parts) {
    return [root, ...parts]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join("/")
}

async function decodePngRgba(bytes) {
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext("2d")
    assert(ctx, "view-markov PNG decode requires 2d context")
    ctx.drawImage(image, 0, 0)
    image.close()
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const colors = []
    for (let i = 0; i < rgba.length; i += 4)
        colors.push(((rgba[i + 3] << 24) >>> 0) | (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2])
    return { width: canvas.width, height: canvas.height, colors }
}

async function decodePngPattern(bytes, legend) {
    const { width, height, colors } = await decodePngRgba(bytes)
    const uniqueColors = []
    const data = colors.map((color) => {
        let index = uniqueColors.indexOf(color)
        if (index < 0) {
            index = uniqueColors.length
            uniqueColors.push(color)
        }
        if (index >= legend.length) throw new Error(`rule PNG uses ${index + 1} colors but legend has ${legend.length}`)
        return legend[index]
    })
    return { width, height, depth: 1, data }
}

function toRows(cells, width, height, values) {
    assert(Array.isArray(cells), "view-markov grid cells must be an array")
    assert(cells.length >= width * height, "view-markov grid cells length does not match dimensions")
    const rows = []
    for (let y = 0; y < height; y += 1) {
        let row = ""
        for (let x = 0; x < width; x += 1) {
            const index = cells[x + y * width]
            row += values[index] ?? "?"
        }
        rows.push(row)
    }
    return rows
}

export class ViewMarkov extends ViewCanvasBase {
    static get observedAttributes() {
        return ["data-source", "data-source-input", "data-mode"]
    }

    constructor() {
        super()
        this.mode = "library"
        this.source = ""
        this.sourceInput = ""
        this.suppressSourceInputAttribute = false
        this.running = false
        this.session = null
        this.playing = false
        this.animationFrame = 0
        this.statusElement = null
        this.metaElement = null
        this.pathElement = null
        this.voxelRenderer = null
        this.currentXmlText = ""
        this.customExample = null
        this.inputGrid = null
        this.currentRunExample = null
        this.voxelPalette = paletteFromSymbolColors(PALETTE)
    }

    connectedCallback() {
        if (this.dataset.ready) return
        this.dataset.ready = "1"

        this.mode = String(
            this.popupProps?.mode ||
                (this.popupProps?.path ? "preview" : "") ||
                this.getAttribute("data-mode") ||
                this.config?.mode ||
                "library",
        )
        this.source = String(
            this.popupProps?.path || this.getAttribute("data-source") || this.config?.defaultSource || "",
        ).trim()
        this.sourceInput = String(this.popupProps?.inputPath || this.getAttribute("data-source-input") || "").trim()
        if (!this.source && this.mode === "library") this.source = this.examples()[0].id
        assert(this.mode === "library" || this.mode === "preview", `view-markov unsupported mode: ${this.mode}`)

        this.innerHTML = `
      <canvas data-element="canvas"></canvas>
      <footer data-element="footer">
        <output data-element="path"></output>
        <output data-element="meta"></output>
        <output data-element="status">Ready</output>
      </footer>
    `

        this.statusElement = this.querySelector('[data-element="status"]')
        this.metaElement = this.querySelector('[data-element="meta"]')
        this.pathElement = this.querySelector('[data-element="path"]')
        assert(this.statusElement instanceof HTMLOutputElement, "view-markov missing status output")
        assert(this.metaElement instanceof HTMLOutputElement, "view-markov missing meta output")
        assert(this.pathElement instanceof HTMLOutputElement, "view-markov missing path output")

        super.connectedCallback()
        this.syncHeaderControls({ resetRunConfig: true })
        this.showReadyState()
        if (this.sourceInput) void this.loadTilemapInputPath(this.sourceInput)
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return
        if (name === "data-source") this.source = String(newValue || "").trim()
        if (name === "data-source-input") this.sourceInput = String(newValue || "").trim()
        if (name === "data-mode") this.mode = String(newValue || "library")
        if (this.suppressSourceInputAttribute) return
        if (this.dataset.ready) {
            void this.dismissSession()
            this.syncHeaderControls({ resetRunConfig: name === "data-source" })
            if (name === "data-source-input") {
                if (this.sourceInput) void this.loadTilemapInputPath(this.sourceInput)
                else void this.clearInputGrid()
            } else {
                this.showReadyState()
            }
        }
    }

    createViewPluginMethods() {
        return {
            reload: async () => {
                await this.resetSession()
                return { ok: true }
            },
            run: async () => {
                await this.stepCurrent()
                return { ok: true }
            },
            zoomIn: async () => {
                this.zoomIn()
                return { ok: true }
            },
            zoomOut: async () => {
                this.zoomOut()
                return { ok: true }
            },
            zoomFit: async () => {
                this.zoomFit()
                return { ok: true }
            },
        }
    }

    createHeaderControlsElement() {
        const toolbar = document.createElement("div")
        toolbar.dataset.element = "toolbar"
        toolbar.innerHTML = `
      <div role="buttongroup" data-element="file-actions">
        <button type="button" data-action="new" aria-label="New MarkovJunior XML" title="New MarkovJunior XML"><i aria-hidden="true">docs</i></button>
        <button type="button" data-action="open" aria-label="Open MarkovJunior XML" title="Open MarkovJunior XML"><i aria-hidden="true">folder_open</i></button>
        <button type="button" data-action="save" class="accent" aria-label="Save MarkovJunior XML" title="Save MarkovJunior XML"><i aria-hidden="true">save</i></button>
        <button type="button" data-action="save-as" aria-label="Save MarkovJunior XML as" title="Save MarkovJunior XML as"><i aria-hidden="true">save_as</i></button>
        <button type="button" data-action="reload" aria-label="Reload MarkovJunior XML" title="Reload MarkovJunior XML"><i aria-hidden="true">refresh</i></button>
      </div>
      <div role="buttongroup" data-element="tool-actions">
        <button type="button" data-action="edit" aria-label="Edit XML" title="Edit XML"><i aria-hidden="true">edit</i></button>
        <button type="button" data-action="compile" aria-label="Compile XML to MJIR JSON" title="Compile XML to MJIR JSON"><i aria-hidden="true">deployed_code_update</i></button>
        <button type="button" data-action="load-input" aria-label="Load tilemap input" title="Load tilemap input"><i aria-hidden="true">input</i></button>
        <button type="button" data-action="clear-input" aria-label="Clear input" title="Clear input"><i aria-hidden="true">close</i></button>
        <input type="number" data-field="seed" aria-label="Seed" title="Seed" min="0" step="1" value="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button type="button" data-action="reroll" aria-label="Reroll seed" title="Reroll seed"><i aria-hidden="true">casino</i></button>
        <input type="number" data-field="steps" aria-label="Steps" title="Steps" min="0" step="1" value="1000" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button type="button" data-action="step" aria-label="Step" title="Step"><i aria-hidden="true">skip_next</i></button>
        <button type="button" data-action="play-pause" aria-label="Play" title="Play"><i aria-hidden="true">play_arrow</i></button>
      </div>
      <div role="buttongroup" data-element="view-actions">
        <button type="button" data-action="zoom-in" aria-label="Zoom in" title="Zoom in"><i aria-hidden="true">zoom_in</i></button>
        <button type="button" data-action="zoom-fit" aria-label="Fit" title="Fit"><i aria-hidden="true">fit_screen</i></button>
        <button type="button" data-action="zoom-out" aria-label="Zoom out" title="Zoom out"><i aria-hidden="true">zoom_out</i></button>
      </div>
    `

        toolbar.querySelector('[data-action="new"]').addEventListener("click", () => void this.new())
        toolbar.querySelector('[data-action="open"]').addEventListener("click", () => void this.open())
        toolbar.querySelector('[data-action="save"]').addEventListener("click", () => void this.save())
        toolbar.querySelector('[data-action="save-as"]').addEventListener("click", () => void this.saveAs())
        toolbar.querySelector('[data-action="reload"]').addEventListener("click", () => void this.reload())
        toolbar.querySelector('[data-action="edit"]').addEventListener("click", () => void this.edit())
        toolbar.querySelector('[data-action="compile"]').addEventListener("click", () => void this.compileToMjirJson())
        toolbar
            .querySelector('[data-action="load-input"]')
            .addEventListener("click", () => void this.loadTilemapInput())
        toolbar.querySelector('[data-action="clear-input"]').addEventListener("click", () => void this.clearInputGrid())
        toolbar.querySelector('[data-action="step"]').addEventListener("click", () => this.stepCurrent())
        toolbar.querySelector('[data-action="play-pause"]').addEventListener("click", () => this.togglePlayback())
        toolbar.querySelector('[data-action="reroll"]').addEventListener("click", () => this.reroll())
        toolbar.querySelector('[data-action="zoom-in"]').addEventListener("click", () => this.zoomIn())
        toolbar.querySelector('[data-action="zoom-fit"]').addEventListener("click", () => this.zoomFit())
        toolbar.querySelector('[data-action="zoom-out"]').addEventListener("click", () => this.zoomOut())
        return toolbar
    }

    examples() {
        const examples = this.config?.examples
        assert(Array.isArray(examples) && examples.length > 0, "view-markov config.examples must be a non-empty array")
        return examples
    }

    populateModelSelect(select) {
        let group = null
        let groupName = ""
        for (const example of this.examples()) {
            const category = String(example.category || "MarkovJunior")
            if (!(group instanceof HTMLOptGroupElement) || groupName !== category) {
                group = document.createElement("optgroup")
                group.label = category
                groupName = category
                select.appendChild(group)
            }
            const option = document.createElement("option")
            option.value = example.id
            option.textContent = exampleSelectLabel(example)
            option.title = `${exampleLabel(example)} · ${example.source}`
            option.dataset.source = example.source
            option.dataset.render = example.render
            option.dataset.dimensions = exampleSizeLabel(example)
            group.appendChild(option)
        }
    }

    selectedExample() {
        const source = this.source || this.config?.defaultSource
        const normalized = source ? normalizePath(source) : ""
        if (
            this.customExample &&
            (this.customExample.id === source || normalizePath(this.customExample.source) === normalized)
        )
            return this.customExample
        return (
            this.examples().find(
                (example) =>
                    example.id === source ||
                    normalizePath(example.source) === normalized ||
                    basename(example.source) === basename(normalized),
            ) || null
        )
    }

    syncHeaderControls({ resetRunConfig = false } = {}) {
        const example = this.selectedExample()
        const seedInput = this.queryHeaderControl('[data-field="seed"]')
        const stepsInput = this.queryHeaderControl('[data-field="steps"]')
        if (resetRunConfig && seedInput instanceof HTMLInputElement && example?.seed != null)
            seedInput.value = String(example.seed)
        if (resetRunConfig && stepsInput instanceof HTMLInputElement && example?.steps != null)
            stepsInput.value = String(example.steps)
        if (this.pathElement instanceof HTMLOutputElement) this.pathElement.textContent = example?.source || this.source
    }

    showReadyState() {
        const example = this.selectedExample()
        this.currentRunExample = null
        this.setData(null, { autoFit: false })
        if (this.metaElement instanceof HTMLOutputElement) {
            this.metaElement.textContent = example
                ? `${example.width} × ${example.height} × ${example.depth} · seed ${this.seed()} · steps ${this.steps()} · ${example.id}`
                : ""
        }
        this.setStatus(
            example ? `${exampleLabel(example)} ready; press Reset or Step` : "Open a MarkovJunior XML model",
            "info",
        )
    }

    setStatus(text, tone = null) {
        assert(this.statusElement instanceof HTMLOutputElement, "view-markov status output is not initialized")
        this.statusElement.textContent = text
        this.statusElement.classList.remove("accent", "success", "warning", "danger", "info")
        if (tone) this.statusElement.classList.add(tone)
    }

    seed() {
        const input = this.queryHeaderControl('[data-field="seed"]')
        assert(input instanceof HTMLInputElement, "view-markov missing seed input")
        const value = Number(input.value)
        assert(Number.isInteger(value) && value >= 0, "view-markov seed must be a non-negative integer")
        return value
    }

    steps() {
        const input = this.queryHeaderControl('[data-field="steps"]')
        assert(input instanceof HTMLInputElement, "view-markov missing steps input")
        const value = Number(input.value)
        assert(Number.isInteger(value) && value >= 0, "view-markov steps must be a non-negative integer")
        return value
    }

    async reroll() {
        const input = this.queryHeaderControl('[data-field="seed"]')
        assert(input instanceof HTMLInputElement, "view-markov missing seed input")
        input.value = String(Math.floor(Math.random() * 0x7fffffff) + 1)
        await this.resetSession()
    }

    disconnectedCallback() {
        this.stopPlayback()
        if (this.voxelRenderer) this.voxelRenderer.dispose()
        this.voxelRenderer = null
        void this.dismissSession()
        super.disconnectedCallback()
    }

    currentSourcePath() {
        const example = this.selectedExample()
        return example?.source || normalizePath(this.source)
    }

    createExampleForPath(path, baseExample = this.selectedExample()) {
        assert(baseExample, "view-markov requires a current model before creating a model file")
        const id = basename(path).replace(/\.xml$/i, "")
        return { ...baseExample, id, name: id, label: id, source: path }
    }

    ensureSourceExample(overrides = {}) {
        const existing = this.selectedExample()
        if (existing) return existing
        const sourcePath = normalizePath(this.source)
        const id = basename(sourcePath).replace(/\.xml$/i, "")
        const example = {
            id,
            name: id,
            label: id,
            category: "Custom",
            source: sourcePath,
            width: Number(overrides.width || 1),
            height: Number(overrides.height || 1),
            depth: Number(overrides.depth || 1),
            steps: Number(overrides.steps || 1000),
            seed: Number(overrides.seed || 1),
            render: String(overrides.render || "2d"),
        }
        this.customExample = example
        return example
    }

    async new() {
        const payload = unwrap(await runtime.call("ui.popup.open", this.createNewPopupOptions()))
        if (!payload || payload.cancelled) return
        const path = typeof payload.path === "string" ? payload.path.trim() : ""
        assert(path.length > 0, "view-markov new requires XML file path")
        const baseExample = this.selectedExample()
        assert(baseExample, "view-markov new requires a current model to use as template metadata")
        const xml =
            this.currentXmlText ||
            unwrap(await runtime.invoke("fs/fs::read-text", baseExample.source), baseExample.source)
        unwrap(await runtime.invoke("fs/fs::write-text", path, xml), path)
        this.currentXmlText = xml
        this.customExample = this.createExampleForPath(path, baseExample)
        this.source = path
        if (this.getAttribute("data-source") !== path) this.setAttribute("data-source", path)
        this.syncHeaderControls({ resetRunConfig: true })
        this.showReadyState()
        await runtime.call("ui.toast.success", { message: `Created ${path}` })
    }

    async open() {
        const baseExample = this.selectedExample()
        const payload = unwrap(await runtime.call("ui.popup.open", this.createOpenPopupOptions()))
        if (!payload || payload.cancelled) return
        const selection = Array.isArray(payload.selection) ? payload.selection[0] : payload.selection
        assert(selection?.path, "view-markov open requires selected XML file path")
        const path = selection.path
        this.source = path
        const knownExample = this.selectedExample()
        this.customExample = knownExample || this.createExampleForPath(path, baseExample)
        if (this.getAttribute("data-source") !== path) this.setAttribute("data-source", path)
        await this.reload()
    }

    async save() {
        const path = this.currentSourcePath()
        const text = this.currentXmlText || unwrap(await runtime.invoke("fs/fs::read-text", path), path)
        unwrap(await runtime.invoke("fs/fs::write-text", path, text), path)
        this.currentXmlText = text
        this.setStatus(`Saved ${path}`, "success")
        await runtime.call("ui.toast.success", { message: `Saved ${path}` })
    }

    async saveAs() {
        const payload = unwrap(await runtime.call("ui.popup.open", this.createSavePopupOptions()))
        if (!payload || payload.cancelled) return
        const path = typeof payload.path === "string" ? payload.path.trim() : ""
        assert(path.length > 0, "view-markov save-as requires XML file path")
        const baseExample = this.selectedExample()
        assert(baseExample, "view-markov save-as requires current model metadata")
        const text =
            this.currentXmlText ||
            unwrap(await runtime.invoke("fs/fs::read-text", baseExample.source), baseExample.source)
        unwrap(await runtime.invoke("fs/fs::write-text", path, text), path)
        this.currentXmlText = text
        this.customExample = this.createExampleForPath(path, baseExample)
        this.source = path
        if (this.getAttribute("data-source") !== path) this.setAttribute("data-source", path)
        this.syncHeaderControls()
        this.setStatus(`Saved as ${path}`, "success")
        await runtime.call("ui.toast.success", { message: `Saved ${path}` })
    }

    async reload() {
        await this.resetSession()
        await runtime.call("ui.toast.success", { message: `Reloaded ${this.currentSourcePath()}` })
    }

    async edit() {
        const path = this.currentSourcePath()
        const payload = unwrap(
            await runtime.call("ui.popup.open", {
                title: "Edit MarkovJunior XML",
                size: "large",
                tag: "view-code",
                attributes: { "data-source": path, "data-lang": "xml" },
            }),
        )
        if (payload && payload.reload) await this.reload()
    }

    async compileToMjirJson() {
        const example = this.inputGrid
            ? this.ensureSourceExample({
                  width: this.inputGrid.width,
                  height: this.inputGrid.height,
                  depth: 1,
                  render: "2d",
              })
            : this.ensureSourceExample()
        const sourcePath = this.currentSourcePath()
        const xml = unwrap(await runtime.invoke("fs/fs::read-text", sourcePath), sourcePath)
        this.currentXmlText = xml
        const compileExample = this.inputGrid
            ? { ...example, width: this.inputGrid.width, height: this.inputGrid.height, depth: 1, render: "2d" }
            : example
        const modelIr = compileXmlToMjir(xml, await this.createCompileOptions(xml, compileExample))
        const outputPath = this.mjirJsonPathForXmlPath(sourcePath)
        unwrap(await runtime.invoke("fs/fs::write-text", outputPath, `${JSON.stringify([...modelIr])}\n`), outputPath)
        this.setStatus(`Compiled ${outputPath}`, "success")
        await runtime.call("ui.toast.success", { message: `Compiled ${outputPath}` })
    }

    mjirJsonPathForXmlPath(path) {
        const normalized = normalizePath(path)
        return normalized.toLowerCase().endsWith(".xml")
            ? `${normalized.slice(0, -4)}.mjir.json`
            : `${normalized}.mjir.json`
    }

    async loadTilemapInput() {
        const payload = unwrap(
            await runtime.call("ui.popup.open", {
                title: "Load Tilemap Input",
                size: "medium",
                tag: "view-files",
                props: { mode: "chooser", filter: "*.tilemap.json,*.json" },
            }),
        )
        if (!payload || payload.cancelled) return
        const selection = Array.isArray(payload.selection) ? payload.selection[0] : payload.selection
        assert(selection && selection.path, "view-markov load input requires selected tilemap file path")
        await this.loadTilemapInputPath(String(selection.path).trim())
    }

    async loadTilemapInputPath(path) {
        assert(path.length > 0, "view-markov load input requires non-empty tilemap file path")
        const tilemap = JSON.parse(unwrap(await runtime.invoke("fs/fs::read-text", path), path))
        const sourcePath = this.currentSourcePath()
        const xml = unwrap(await runtime.invoke("fs/fs::read-text", sourcePath), sourcePath)
        this.currentXmlText = xml
        this.inputGrid = this.tilemapInputGridFromTilemap(tilemap, path, 0, this.valuesFromXml(xml))
        this.ensureSourceExample({ width: this.inputGrid.width, height: this.inputGrid.height, depth: 1, render: "2d" })
        this.sourceInput = path
        if (this.getAttribute("data-source-input") !== path) {
            this.suppressSourceInputAttribute = true
            this.setAttribute("data-source-input", path)
            this.suppressSourceInputAttribute = false
        }
        await this.dismissSession()
        this.showInputGridPreview(xml)
        this.setStatus(`Loaded input ${this.inputGrid.path} · layer ${this.inputGrid.layerLabel}`, "success")
    }

    async clearInputGrid() {
        this.inputGrid = null
        this.sourceInput = ""
        this.currentRunExample = null
        if (this.getAttribute("data-source-input") !== "") {
            this.suppressSourceInputAttribute = true
            this.removeAttribute("data-source-input")
            this.suppressSourceInputAttribute = false
        }
        await this.dismissSession()
        this.showReadyState()
    }

    assertInputGridMatchesXml(xml) {
        assert(this.inputGrid, "view-markov input validation requires loaded input grid")
        const values = this.valuesFromXml(xml)
        for (let index = 0; index < this.inputGrid.cells.length; index += 1) {
            const cell = this.inputGrid.cells[index]
            assert(
                cell >= 0 && cell < values.length,
                `view-markov input cell ${index + 1} value ${cell} is outside Markov values range 0..${values.length - 1}`,
            )
        }
    }

    valuesFromXml(xml) {
        const values = xmlAttr(xmlRootStartTag(xml), "values", "")
        assert(values.length > 0, "view-markov XML root must declare values before loading tilemap input")
        return values
    }

    tilemapInputGridFromTilemap(tilemap, path, layerIndexZero, values) {
        assert(
            tilemap && typeof tilemap === "object" && !Array.isArray(tilemap),
            "view-markov tilemap input must be an object",
        )
        assert(Array.isArray(tilemap.layers), "view-markov tilemap.layers must be an array")
        assert(tilemap.layers.length > layerIndexZero, `view-markov tilemap missing layer ${layerIndexZero + 1}`)
        const layer = tilemap.layers[layerIndexZero]
        assert(
            layer && typeof layer === "object" && !Array.isArray(layer),
            "view-markov tilemap layer must be an object",
        )
        const width = Number(layer.width)
        assert(Number.isInteger(width) && width > 0, "view-markov tilemap layer.width must be a positive integer")
        assert(Array.isArray(layer.data), "view-markov tilemap layer.data must be an array")
        assert(layer.data.length > 0, "view-markov tilemap layer.data must not be empty")
        assert(
            layer.data.length % width === 0,
            "view-markov tilemap layer.data length must be divisible by layer.width",
        )
        const cells = layer.data.map((value, index) => {
            const cell = Number(value)
            assert(Number.isInteger(cell), `view-markov tilemap cell ${index + 1} must be an integer`)
            assert(
                cell >= 0 && cell < values.length,
                `view-markov tilemap cell ${index + 1} value ${cell} is outside Markov values range 0..${values.length - 1}`,
            )
            return cell
        })
        const layerProps = layer.props
        const layerName =
            layerProps && typeof layerProps === "object" && !Array.isArray(layerProps)
                ? String(layerProps.name || "").trim()
                : ""
        return {
            type: "tilemap",
            path,
            layerIndex: layerIndexZero + 1,
            layerLabel: layerName || String(layerIndexZero + 1),
            width,
            height: cells.length / width,
            depth: 1,
            cells,
        }
    }

    inputGridMetaLabel() {
        if (!this.inputGrid) return ""
        return ` · input ${this.inputGrid.path} layer ${this.inputGrid.layerLabel}`
    }

    showInputGridPreview(xml = this.currentXmlText) {
        assert(this.inputGrid, "view-markov input preview requires loaded input grid")
        const example = this.ensureSourceExample({
            width: this.inputGrid.width,
            height: this.inputGrid.height,
            depth: 1,
            render: "2d",
        })
        const values = this.valuesFromXml(xml)
        const previewExample = {
            ...example,
            width: this.inputGrid.width,
            height: this.inputGrid.height,
            depth: 1,
            render: "2d",
        }
        this.currentRunExample = previewExample
        this.applyGrid(
            {
                width: this.inputGrid.width,
                height: this.inputGrid.height,
                depth: 1,
                values,
                cells: [...this.inputGrid.cells],
                "steps-run": 0,
                changed: 0,
                done: false,
            },
            previewExample,
            0,
        )
    }

    createOpenPopupOptions() {
        return {
            title: "Open MarkovJunior XML",
            size: "medium",
            tag: "view-files",
            props: { mode: "chooser", filter: "*.xml" },
        }
    }

    createNewPopupOptions() {
        return {
            title: "Create MarkovJunior XML",
            size: "medium",
            tag: "view-files",
            props: { mode: "saver", filter: "*.xml", defaultName: "new-markov.xml" },
        }
    }

    createSavePopupOptions() {
        return {
            title: "Save MarkovJunior XML As",
            size: "medium",
            tag: "view-files",
            props: {
                mode: "saver",
                filter: "*.xml",
                defaultName: `${basename(this.currentSourcePath()).replace(/\.xml$/i, "") || "markov"}.xml`,
            },
        }
    }

    async readFile(path) {
        return new Uint8Array(unwrap(await runtime.invoke("fs/fs::read-file", path), path))
    }

    async readOptionalFile(path) {
        try {
            return await this.readFile(path)
        } catch (error) {
            const message = String(error?.message || error)
            if (
                message.includes("no-entry") ||
                message.includes("No such file") ||
                message.includes("not found") ||
                message.includes("os error 2")
            )
                return null
            throw error
        }
    }

    async createCompileOptions(xml, example) {
        const resourceRoot = normalizePath(this.config?.resourceRoot || "markov-junior/resources")
        const folder = xmlAttr(xmlRootStartTag(xml), "folder", "")
        const rulePatterns = new Map()
        const ruleVox = new Map()
        const samplePngs = new Map()
        const tilesetXml = new Map()
        const tileVox = new Map()

        const ruleFolders = unique([folder, ...uniqueXmlAttrValues(xml, "folder")])
        for (const file of unique([
            ...uniqueXmlAttrValues(xml, "file"),
            ...uniqueXmlAttrValues(xml, "fin"),
            ...uniqueXmlAttrValues(xml, "fout"),
        ])) {
            for (const ruleFolder of ruleFolders) {
                if (example.depth === 1) {
                    const pngPath = joinResourcePath(resourceRoot, "rules", ruleFolder, `${file}.png`)
                    const png = await this.readOptionalFile(pngPath)
                    if (png)
                        rulePatterns.set(
                            `${ruleFolder}\0${file}`,
                            await decodePngPattern(png, this.legendForRule(xml, file)),
                        )
                } else {
                    const voxPath = joinResourcePath(resourceRoot, "rules", ruleFolder, `${file}.vox`)
                    const vox = await this.readOptionalFile(voxPath)
                    if (vox) ruleVox.set(`${ruleFolder}\0${file}`, vox)
                }
            }
        }

        for (const sample of unique(uniqueXmlAttrValues(xml, "sample"))) {
            const samplePath = joinResourcePath(resourceRoot, "samples", `${sample}.png`)
            samplePngs.set(sample, await decodePngRgba(await this.readFile(samplePath)))
        }

        for (const tileset of unique(uniqueXmlAttrValues(xml, "tileset"))) {
            const tilesetPath = joinResourcePath(resourceRoot, "tilesets", `${tileset}.xml`)
            const text = unwrap(await runtime.invoke("fs/fs::read-text", tilesetPath), tilesetPath)
            tilesetXml.set(tileset, text)
            for (const tilesName of tileDirectoriesForTileset(xml, tileset)) {
                for (const tileName of unique(uniqueXmlAttrValues(text, "name"))) {
                    const voxPath = joinResourcePath(resourceRoot, "tilesets", tilesName, `${tileName}.vox`)
                    tileVox.set(`${tilesName}\0${tileName}`, await this.readFile(voxPath))
                }
            }
        }

        return {
            folder,
            depth: example.depth,
            loadRulePattern: (file, legend, requestedFolder = "") => {
                const key = `${requestedFolder}\0${file}`
                const pattern = rulePatterns.get(key)
                if (pattern) return pattern
                return undefined
            },
            loadRuleVox: (file, requestedFolder = "") => ruleVox.get(`${requestedFolder}\0${file}`),
            loadSamplePng: (sample) => samplePngs.get(sample),
            loadTilesetXml: (name) => tilesetXml.get(name),
            loadTileVox: (tilesName, tileName) => tileVox.get(`${tilesName}\0${tileName}`),
        }
    }

    legendForRule(xml, file) {
        const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const match = xml.match(new RegExp(`<[^>]+\\b(?:file|fin|fout)="${escaped}"[^>]*\\blegend="([^"]+)"`))
        assert(match, `view-markov rule resource ${file} missing legend attribute`)
        return match[1]
    }

    async dismissSession({ stopPlayback = true } = {}) {
        if (stopPlayback) this.stopPlayback()
        if (!this.session) return
        const session = this.session
        this.session = null
        unwrap(await runtime.invoke("markov-junior/markov-junior::dismiss", session), "markov-junior.dismiss")
        await runtime.releaseResource(session)
    }

    async resetSession({ preservePlayback = false } = {}) {
        if (this.running) return
        this.running = true
        const started = performance.now()
        try {
            await this.dismissSession({ stopPlayback: !preservePlayback })
            const example = this.inputGrid
                ? this.ensureSourceExample({
                      width: this.inputGrid.width,
                      height: this.inputGrid.height,
                      depth: 1,
                      render: "2d",
                  })
                : this.ensureSourceExample()
            this.source = example.id
            this.syncHeaderControls()
            const runExample = this.inputGrid
                ? { ...example, width: this.inputGrid.width, height: this.inputGrid.height, depth: 1, render: "2d" }
                : example
            this.currentRunExample = runExample
            assert(
                runExample.render === "2d" || runExample.render === "vox",
                `view-markov unsupported render mode: ${runExample.render}`,
            )
            if (runExample.render === "2d") this.ensure2dCanvas()
            if (runExample.render === "vox") {
                assert(runExample.depth > 1, `view-markov vox render requires depth > 1 for ${runExample.id}`)
                assert(
                    typeof runExample.transparent === "string",
                    `view-markov vox example ${runExample.id} requires transparent symbols`,
                )
                this.ensureVoxelCanvas()
            }

            this.setStatus(`Resetting ${exampleLabel(example)}...`, "info")
            const xml = unwrap(await runtime.invoke("fs/fs::read-text", example.source), example.source)
            this.currentXmlText = xml
            const modelIr = compileXmlToMjir(xml, await this.createCompileOptions(xml, runExample))
            if (this.inputGrid) this.assertInputGridMatchesXml(xml)
            const initialCells = this.inputGrid
                ? [...this.inputGrid.cells]
                : initialGridFromXml(xml, runExample.width, runExample.height, runExample.depth)
            const state = unwrap(
                await runtime.invoke("markov-junior/markov-junior::create", modelIr, initialCells, {
                    width: runExample.width,
                    height: runExample.height,
                    depth: runExample.depth,
                    seed: this.seed(),
                }),
                "markov-junior.create",
            )
            this.session = state.handle
            this.applyGrid(state.grid, runExample, Math.round(performance.now() - started))
            this.setStatus(`${exampleLabel(example)} ready in ${Math.round(performance.now() - started)}ms`, "success")
        } catch (error) {
            this.session = null
            this.currentRunExample = null
            this.setData(null, { autoFit: false })
            this.setStatus(`Error: ${error?.message || error}`, "danger")
            console.error("view-markov reset failed:", error)
        } finally {
            this.running = false
        }
    }

    async stepCurrent(stepBudget = this.steps()) {
        assert(
            Number.isInteger(stepBudget) && stepBudget >= 0,
            "view-markov step budget must be a non-negative integer",
        )
        if (this.running) return
        if (!this.session) await this.resetSession({ preservePlayback: this.playing })
        if (!this.session) {
            if (this.playing) this.stopPlayback()
            return
        }
        this.running = true
        const started = performance.now()
        try {
            const example = this.currentRunExample || this.selectedExample()
            assert(example, `view-markov could not resolve source '${this.source}'`)
            const grid = unwrap(
                await runtime.invoke("markov-junior/markov-junior::step", this.session, stepBudget),
                "markov-junior.step",
            )
            this.applyGrid(grid, example, Math.round(performance.now() - started), { autoFit: false })
            this.setStatus(
                grid.done
                    ? `Done in ${grid["steps-run"]} steps`
                    : `Stepped in ${Math.round(performance.now() - started)}ms`,
                grid.done ? "success" : "info",
            )
            if (grid.done) this.stopPlayback()
        } catch (error) {
            this.stopPlayback()
            this.setStatus(`Error: ${error?.message || error}`, "danger")
            console.error("view-markov step failed:", error)
        } finally {
            this.running = false
        }
    }

    togglePlayback() {
        if (this.playing) {
            this.stopPlayback()
            return
        }
        this.playing = true
        this.syncPlaybackButton()
        this.animationFrame = requestAnimationFrame(() => this.playbackTick())
    }

    stopPlayback() {
        this.playing = false
        if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame)
        this.animationFrame = 0
        this.syncPlaybackButton()
    }

    syncPlaybackButton() {
        const button = this.queryHeaderControl('[data-action="play-pause"]')
        if (!(button instanceof HTMLButtonElement)) return
        const icon = button.querySelector("i")
        if (icon) icon.textContent = this.playing ? "pause" : "play_arrow"
        button.setAttribute("aria-label", this.playing ? "Pause" : "Play")
        button.setAttribute("title", this.playing ? "Pause" : "Play")
    }

    async playbackTick() {
        if (!this.playing) return
        await this.stepCurrent()
        if (!this.playing) return
        this.animationFrame = requestAnimationFrame(() => this.playbackTick())
    }

    _onResized(width, height) {
        if (this.voxelRenderer) {
            this.voxelRenderer.resize(width, height)
            return
        }
        super._onResized(width, height)
    }

    applyCanvasLayout() {
        assert(this.canvas instanceof HTMLCanvasElement, "view-markov missing canvas")
        this.canvas.style.width = "100%"
        this.canvas.style.height = "100%"
        this.canvas.style.minWidth = "0"
        this.canvas.style.minHeight = "0"
        this.canvas.style.maxWidth = "100%"
        this.canvas.style.maxHeight = "100%"
        this.canvas.style.justifySelf = "stretch"
        this.canvas.style.alignSelf = "stretch"
    }

    replaceCanvas() {
        assert(this.canvas instanceof HTMLCanvasElement, "view-markov missing canvas")
        this._resizeObserver.unobserve(this.canvas)
        this._removeEventListeners()
        const replacement = document.createElement("canvas")
        replacement.dataset.element = "canvas"
        this.canvas.replaceWith(replacement)
        this.canvas = replacement
        this.applyCanvasLayout()
        this._resizeObserver.observe(this.canvas)
        return replacement
    }

    ensureVoxelCanvas() {
        if (this.voxelRenderer) return
        this.replaceCanvas()
        this.ctx = null
        this.voxelRenderer = new VoxelOrbitRenderer(this.canvas)
    }

    ensure2dCanvas() {
        if (!this.voxelRenderer && this.ctx) return
        if (this.voxelRenderer) {
            this.voxelRenderer.dispose()
            this.voxelRenderer = null
            this.replaceCanvas()
        }
        this.ctx = this.canvas.getContext("2d")
        assert(this.ctx, "view-markov failed to create 2d context")
        this.ctx.imageSmoothingEnabled = false
        this._addEventListeners()
    }

    zoomIn() {
        if (this.voxelRenderer) {
            this.voxelRenderer.zoom(0.8)
            return
        }
        super.zoomIn()
    }

    zoomOut() {
        if (this.voxelRenderer) {
            this.voxelRenderer.zoom(1.25)
            return
        }
        super.zoomOut()
    }

    zoomFit() {
        if (this.voxelRenderer) {
            this.voxelRenderer.fit()
            return true
        }
        return super.zoomFit()
    }

    applyGrid(grid, example, durationMs, { autoFit = true } = {}) {
        assert(grid && typeof grid === "object" && !Array.isArray(grid), "view-markov grid must be object")
        if (example.render === "vox") {
            this.ensureVoxelCanvas()
            const renderData = voxelRenderDataFromIndexedGrid(grid, {
                ...this.voxelPalette,
                transparent: example.transparent,
            })
            this.voxelRenderer.setInstances(renderData)
            this.data = { ...grid, render: "vox" }
        } else {
            this.ensure2dCanvas()
            const rows = toRows(grid.cells, grid.width, grid.height, grid.values)
            this.setData({ ...grid, rows, render: "2d" }, { autoFit })
        }
        assert(this.metaElement instanceof HTMLOutputElement, "view-markov meta output is not initialized")
        this.metaElement.textContent = `${grid.width} × ${grid.height} × ${grid.depth} · values ${grid.values} · seed ${this.seed()} · steps ${grid["steps-run"]}/${this.steps()} · changed ${grid.changed}${grid.done ? " · done" : ""} · ${durationMs}ms · ${example.id}${this.inputGridMetaLabel()}`
    }

    calculateContentBounds(data) {
        if (!data || data.render === "vox") return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
        return { minX: 0, minY: 0, maxX: data.width, maxY: data.height }
    }

    drawContent(ctx, data) {
        if (!data || data.render === "vox") return
        ctx.fillStyle = "#101820"
        ctx.fillRect(0, 0, data.width, data.height)
        for (let y = 0; y < data.height; y += 1) {
            const row = data.rows[y]
            for (let x = 0; x < data.width; x += 1) {
                ctx.fillStyle = PALETTE[row[x]] || "#ff00ff"
                ctx.fillRect(x, y, 1, 1)
            }
        }
    }
}

if (!customElements.get("view-markov")) {
    customElements.define("view-markov", ViewMarkov)
}
