import init, { GameOfLife } from "./pkg/game_of_life.js";

const GRID_MIN_SIZE = 10;
const GRID_MAX_SIZE = 2000;
const BRUSH_CURSOR_SVG = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\"><circle cx=\"10\" cy=\"10\" r=\"8\" fill=\"none\" stroke=\"%2300ff41\" stroke-width=\"2\"/></svg>') 10 10, crosshair";
const CANVAS_ID = "gameCanvas";
let gameOfLife = null;
let isPlaying = false;
let animationId = null;
let speed = 100;
let generation = 0;
let fpsCounter = 0;
let lastFpsTime = Date.now();

let drawMode = "single";
let isDrawing = false;
let lastDrawPos = null;
let brushSize = 3;

let previewCanvas = null;
let previewCtx = null;
let isPreviewActive = false;

let lastValidGridWidth = 200;
let lastValidGridHeight = 150;

async function run() {
    await init();
    
    const canvas = document.getElementById(CANVAS_ID);
    const gridWidth = parseInt(document.getElementById("gridWidth").value);
    const gridHeight = parseInt(document.getElementById("gridHeight").value);
    
    canvas.width = 800;
    canvas.height = 600;
    
    try {
        gameOfLife = new GameOfLife(CANVAS_ID, gridWidth, gridHeight);
        console.log("Game of Life created successfully");
        
        lastValidGridWidth = gridWidth;
        lastValidGridHeight = gridHeight;
        
        setupEventListeners();
        gameOfLife.render();
        updateStats();
        createPreviewCanvas();
    } catch (error) {
        console.error("Failed to initialize Game of Life:", error);
    }
}

function setupEventListeners() {
    const canvas = document.getElementById(CANVAS_ID);
    
    canvas.addEventListener("click", () => {
        canvas.focus();
    });
    
    canvas.addEventListener("mousedown", handleCanvasMouseDown);
    canvas.addEventListener("mousemove", handleCanvasMouseMove);
    canvas.addEventListener("mouseup", handleCanvasMouseUp);
    canvas.addEventListener("mouseleave", handleCanvasMouseUp);
    
    canvas.addEventListener("touchstart", handleCanvasTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleCanvasTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleCanvasTouchEnd, { passive: false });
    
    document.getElementById("playPause").addEventListener("click", togglePlayPause);
    document.getElementById("step").addEventListener("click", step);
    document.getElementById("randomize").addEventListener("click", randomize);
    document.getElementById("clear").addEventListener("click", clear);
    
    document.querySelectorAll(".tool-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            setDrawMode(e.target.dataset.mode);
        });
    });
    
    document.getElementById("applyGridSize").addEventListener("click", resizeGrid);
    
    document.getElementById("gridWidth").addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            resizeGrid();
        }
    });
    
    document.getElementById("gridHeight").addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            resizeGrid();
        }
    });
    
    document.getElementById("glider").addEventListener("click", loadGlider);
    document.getElementById("blinker").addEventListener("click", loadBlinker);
    document.getElementById("beacon").addEventListener("click", loadBeacon);
    document.getElementById("toad").addEventListener("click", loadToad);
    document.getElementById("spaceship").addEventListener("click", loadSpaceship);
    document.getElementById("pulsar").addEventListener("click", loadPulsar);
    document.getElementById("gliderGun").addEventListener("click", loadGliderGun);
    
    const speedSlider = document.getElementById("speed");
    const brushSlider = document.getElementById("brushSize");
    
    speedSlider.addEventListener("input", (e) => {
        speed = parseInt(e.target.value);
        document.getElementById("speedValue").textContent = speed;
    });
    
    brushSlider.addEventListener("input", (e) => {
        brushSize = parseInt(e.target.value);
        document.getElementById("brushSizeValue").textContent = brushSize;
    });
    
    window.addEventListener("resize", () => {
        if (previewCanvas) {
            const canvas = document.getElementById(CANVAS_ID);
            previewCanvas.style.top = canvas.offsetTop + 'px';
            previewCanvas.style.left = canvas.offsetLeft + 'px';
        }
    });
}

function createPreviewCanvas() {
    const canvas = document.getElementById(CANVAS_ID);
    const container = canvas.parentElement;
    
    previewCanvas = document.createElement('canvas');
    previewCanvas.id = 'previewCanvas';
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    previewCanvas.style.position = 'absolute';
    previewCanvas.style.top = canvas.offsetTop + 'px';
    previewCanvas.style.left = canvas.offsetLeft + 'px';
    previewCanvas.style.pointerEvents = 'none';
    previewCanvas.style.zIndex = '10';
    
    container.style.position = 'relative';
    container.appendChild(previewCanvas);
    
    previewCtx = previewCanvas.getContext('2d');
}

function drawLinePreview(startX, startY, endX, endY) {
    if (!previewCanvas || !previewCtx) return;
    
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    
    const canvas = document.getElementById(CANVAS_ID);
    const gridWidth = parseInt(document.getElementById("gridWidth").value);
    const gridHeight = parseInt(document.getElementById("gridHeight").value);
    
    const cellWidth = canvas.width / gridWidth;
    const cellHeight = canvas.height / gridHeight;
    
    const canvasStartX = (startX + 0.5) * cellWidth;
    const canvasStartY = (gridHeight - startY - 0.5) * cellHeight;
    const canvasEndX = (endX + 0.5) * cellWidth;
    const canvasEndY = (gridHeight - endY - 0.5) * cellHeight;
    
    previewCtx.strokeStyle = '#00ff41';
    previewCtx.lineWidth = 2;
    previewCtx.setLineDash([5, 5]);
    previewCtx.beginPath();
    previewCtx.moveTo(canvasStartX, canvasStartY);
    previewCtx.lineTo(canvasEndX, canvasEndY);
    previewCtx.stroke();
}

function clearLinePreview() {
    if (previewCtx) {
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    isPreviewActive = false;
}

function getCanvasCoordinates(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);
    
    const gridWidth = parseInt(document.getElementById("gridWidth").value);
    const gridHeight = parseInt(document.getElementById("gridHeight").value);
    
    const cellX = Math.floor((x / canvas.width) * gridWidth);
    const cellY = gridHeight - 1 - Math.floor((y / canvas.height) * gridHeight);
    
    return { cellX, cellY };
}

function handleCanvasMouseDown(e) {
    if (!gameOfLife) return;
    
    const canvas = document.getElementById(CANVAS_ID);
    const { cellX, cellY } = getCanvasCoordinates(canvas, e.clientX, e.clientY);
    
    isDrawing = true;
    lastDrawPos = { x: cellX, y: cellY };
    
    if (drawMode === "single") {
        gameOfLife.toggle_cell(cellX, cellY);
        gameOfLife.render();
    } else if (drawMode === "brush") {
        drawBrush(cellX, cellY);
        gameOfLife.render();
    }
}

function handleCanvasMouseMove(e) {
    if (!gameOfLife) return;
    
    const canvas = document.getElementById(CANVAS_ID);
    const { cellX, cellY } = getCanvasCoordinates(canvas, e.clientX, e.clientY);
    
    if (drawMode === "line" && isDrawing && lastDrawPos) {
        drawLinePreview(lastDrawPos.x, lastDrawPos.y, cellX, cellY);
        isPreviewActive = true;
    } else if (drawMode === "brush" && isDrawing) {
        drawBrush(cellX, cellY);
        gameOfLife.render();
        lastDrawPos = { x: cellX, y: cellY };
    }
}

function handleCanvasMouseUp(e) {
    if (!gameOfLife || !isDrawing) return;
    
    const canvas = document.getElementById(CANVAS_ID);
    const { cellX, cellY } = getCanvasCoordinates(canvas, e.clientX, e.clientY);
    
    if (drawMode === "line" && lastDrawPos) {
        clearLinePreview();
        gameOfLife.draw_line(lastDrawPos.x, lastDrawPos.y, cellX, cellY);
        gameOfLife.render();
    }
    
    isDrawing = false;
    lastDrawPos = null;
}

function handleCanvasTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    handleCanvasMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
}

function handleCanvasTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    handleCanvasMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function handleCanvasTouchEnd(e) {
    e.preventDefault();
    if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        handleCanvasMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
    }
}

function drawBrush(centerX, centerY) {
    const radius = Math.floor(brushSize / 2);
    
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            if (dx * dx + dy * dy <= radius * radius) {
                const x = centerX + dx;
                const y = centerY + dy;
                if (x >= 0 && y >= 0) {
                    gameOfLife.set_cell(x, y, 255);
                }
            }
        }
    }
}

function setDrawMode(mode) {
    drawMode = mode;
    document.getElementById("currentDrawMode").textContent = mode.toUpperCase();
    
    document.querySelectorAll(".tool-btn").forEach(btn => {
        btn.classList.remove("active");
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add("active");
    
    const canvas = document.getElementById(CANVAS_ID);
    if (mode === "brush") {
        canvas.style.cursor = BRUSH_CURSOR_SVG;
    } else {
        canvas.style.cursor = "crosshair";
    }
}

function gameLoop() {
    if (!gameOfLife || !isPlaying) return;
    
    try {
        gameOfLife.step();
        gameOfLife.render();
        generation++;
        updateStats();
        
        fpsCounter++;
        const now = Date.now();
        if (now - lastFpsTime >= 1000) {
            document.getElementById("fpsCounter").textContent = fpsCounter;
            fpsCounter = 0;
            lastFpsTime = now;
        }
    } catch (error) {
        console.error("Error in game loop:", error);
        stop();
    }
    
    setTimeout(() => {
        if (isPlaying) {
            animationId = requestAnimationFrame(gameLoop);
        }
    }, speed);
}

function updateStats() {
    document.getElementById("generationCounter").textContent = generation;
}

function togglePlayPause() {
    if (isPlaying) {
        stop();
    } else {
        play();
    }
}

function play() {
    if (!gameOfLife) return;
    
    isPlaying = true;
    document.getElementById("playPause").innerHTML = "⏸ PAUSE";
    document.getElementById("playPause").classList.add("active");
    gameLoop();
}

function stop() {
    isPlaying = false;
    document.getElementById("playPause").innerHTML = "▶ PLAY";
    document.getElementById("playPause").classList.remove("active");
    
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

function step() {
    if (!gameOfLife || isPlaying) return;
    
    try {
        gameOfLife.step();
        gameOfLife.render();
        generation++;
        updateStats();
    } catch (error) {
        console.error("Error in step:", error);
    }
}

function randomize() {
    if (!gameOfLife) return;
    
    try {
        gameOfLife.randomize();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error in randomize:", error);
    }
}

function clear() {
    if (!gameOfLife) return;
    
    try {
        gameOfLife.clear();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error in clear:", error);
    }
}

function resizeGrid() {
    const gridWidthInput = document.getElementById("gridWidth");
    const gridHeightInput = document.getElementById("gridHeight");
    const gridWidth = parseInt(gridWidthInput.value);
    const gridHeight = parseInt(gridHeightInput.value);
    
    gridWidthInput.blur();
    gridHeightInput.blur();
    
    if (!gameOfLife || gridWidth < GRID_MIN_SIZE || gridHeight < GRID_MIN_SIZE || gridWidth > GRID_MAX_SIZE || gridHeight > GRID_MAX_SIZE) {
        const warningElement = document.createElement('div');
        warningElement.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff4444;
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            z-index: 1000;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;
        warningElement.textContent = `Invalid dimensions (${gridWidth}x${gridHeight}). Restoring previous values (${lastValidGridWidth}x${lastValidGridHeight}).`;
        document.body.appendChild(warningElement);
        
        setTimeout(() => {
            if (document.body.contains(warningElement)) {
                document.body.removeChild(warningElement);
            }
        }, 3000);
        
        gridWidthInput.value = lastValidGridWidth;
        gridHeightInput.value = lastValidGridHeight;
        
        setTimeout(() => {
            resizeGrid();
        }, 500);
        
        return;
    }
    
    try {
        lastValidGridWidth = gridWidth;
        lastValidGridHeight = gridHeight;
        
        gameOfLife.resize(gridWidth, gridHeight);
        gameOfLife.render();
        generation = 0;
        updateStats();

        if (previewCanvas) {
            const canvas = document.getElementById(CANVAS_ID);
            previewCanvas.width = canvas.width;
            previewCanvas.height = canvas.height;
        }
        
        console.log(`Grid resized to ${gridWidth}x${gridHeight}`);
    } catch (error) {
        console.error("Error resizing grid:", error);
    }
}

function loadGlider() {
    if (!gameOfLife) return;
    try {
        gameOfLife.load_glider();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error loading glider:", error);
    }
}

function loadBlinker() {
    if (!gameOfLife) return;
    try {
        gameOfLife.load_oscillator();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error loading blinker:", error);
    }
}

function loadBeacon() {
    if (!gameOfLife) return;
    try {
        gameOfLife.load_beacon();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error loading beacon:", error);
    }
}

function loadToad() {
    if (!gameOfLife) return;
    try {
        gameOfLife.load_toad();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error loading toad:", error);
    }
}

function loadSpaceship() {
    if (!gameOfLife) return;
    try {
        gameOfLife.load_spaceship();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error loading spaceship:", error);
    }
}

function loadPulsar() {
    if (!gameOfLife) return;
    try {
        gameOfLife.load_pulsar();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error loading pulsar:", error);
    }
}

function loadGliderGun() {
    if (!gameOfLife) return;
    try {
        gameOfLife.load_glider_gun();
        gameOfLife.render();
        generation = 0;
        updateStats();
    } catch (error) {
        console.error("Error loading glider gun:", error);
    }
}

run();
