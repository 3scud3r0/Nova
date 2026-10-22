# Conway's Game of Life - WebAssembly

A high-performance implementation of Conway's Game of Life using Rust, WebAssembly, and WebGL for GPU-accelerated rendering with an enhanced techy interface and advanced drawing tools.

## Features

- **GPU-accelerated**: Uses WebGL compute shaders for high-performance simulation
- **Advanced Drawing Tools**: Three drawing modes with real-time preview
  - Single pixel toggle mode
  - Line drawing with live preview
  - Brush tool with adjustable size (1-10 pixels)
- **Interactive Grid**: Dynamic grid resizing with intelligent validation and auto-correction
- **Pattern Library**: Pre-built patterns including gliders, oscillators, and spaceships
- **Performance Monitoring**: Real-time FPS counter and generation tracking
- **Responsive**: Works on desktop and mobile browsers with touch support
- **Large Grid Support**: Supports grid sizes from 10x10 to 2000x2000 cells
- **Auto-focus Management**: Seamless interaction without input focus conflicts

## Drawing Tools

### Single Pixel Mode
- Click to toggle individual cells on
- Default drawing mode for precise cell placement

### Line Drawing Mode
- Click and drag to draw straight lines
- Real-time dashed green preview while dragging
- Uses Bresenham's line algorithm for pixel-perfect lines

### Brush Mode
- Paint with a circular brush of adjustable size
- Brush size range: 1-10 pixels
- Custom cursor shows brush area
- Perfect for creating large patterns quickly

## Patterns Included

- **Glider**: A simple spaceship that travels diagonally
- **Blinker**: A basic oscillator with period 2
- **Beacon**: A period-2 oscillator
- **Toad**: Another period-2 oscillator
- **Lightweight Spaceship**: Travels horizontally
- **Pulsar**: A large period-3 oscillator
- **Gosper Glider Gun**: Produces gliders indefinitely

## Live Demo

Visit the live demo: [https://game-of-life.alebridi.it](https://game-of-life.alebridi.it/)

## Local Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)

### Building

#### Option 1

```bash
# Clone the repository
git clone https://github.com/Bridiro/game-of-life.git
cd game-of-life

# Build the WebAssembly module
wasm-pack build --target web

# Serve the web directory (choose one option)
cd web

# Option 1: Python
python3 -m http.server 8000

# Option 2: Node.js
npx serve -p 8000

# Option 3: Any static file server
# Open http://localhost:8000 in your browser
```

#### Option 2

```bash
# Open it and make sure I'm not installing viruses, then:
./serve.sh
```

### Development Tips

- Use browser developer tools to monitor WebGL performance
- Large grids (>1000x1000) may impact performance on lower-end devices  
- The application works best in modern browsers with WebGL 1.0 support
- For debugging, check the browser console for WebGL errors

## Architecture

The project is structured as a modular Rust codebase with enhanced user interface:

### Backend (Rust/WebAssembly)
- **`lib.rs`**: Main game struct, WebAssembly bindings, and drawing functions
- **`webgl.rs`**: WebGL context initialization and utilities
- **`shaders.rs`**: WebGL shader programs for compute and rendering
- **`patterns.rs`**: Conway's Game of Life pattern definitions with auto-scaling
- **`texture.rs`**: GPU texture management and data upload

### Frontend (JavaScript/HTML/CSS)
- **`script.js`**: User interaction, drawing tools, and preview system
- **`index.html`**: Terminal-inspired interface with control panels
- **`style.css`**: Dark techy theme with green accent colors

### Drawing System
- **Coordinate Conversion**: Handles canvas-to-grid coordinate mapping with Y-axis correction
- **Line Preview**: Overlay canvas system for real-time drawing feedback  
- **Brush Tools**: Circular brush implementation with GPU-optimized cell setting
- **Focus Management**: Seamless interaction without input conflicts

The simulation runs entirely on the GPU using WebGL fragment shaders, allowing for high-performance computation even with grids up to 2000x2000 cells.

## How It Works

### Core Simulation
1. **State Storage**: Game state stored in WebGL textures (RGBA format, R channel = cell state)
2. **Compute Shader**: Fragment shader implements Conway's rules using GPU parallelization
3. **Render Shader**: Separate shader renders the state with visual styling
4. **Double Buffering**: Two textures alternate each generation for efficient computation

### Drawing System
1. **Coordinate Mapping**: Converts mouse/touch coordinates to grid positions with Y-axis correction
2. **Line Preview**: Overlay canvas shows dashed preview lines during line drawing
3. **Brush Rendering**: Circular brush uses distance calculation for smooth edges
4. **GPU Updates**: Individual cell changes uploaded directly to GPU textures

### User Interface
1. **Input Validation**: Grid size inputs auto-correct to valid ranges (10-2000)
2. **Focus Management**: Canvas automatically regains focus after form interactions
3. **Performance Monitoring**: Real-time FPS and generation counters
4. **Responsive Design**: Interface adapts to different screen sizes

### Pattern System
1. **Auto-scaling**: Patterns automatically scale to fit current grid dimensions
2. **Centered Placement**: Patterns positioned at grid center for optimal viewing
3. **GPU Upload**: Pattern data uploaded efficiently to GPU textures

## Controls

### Simulation Controls
- **Play/Pause**: Start/stop the automatic simulation
- **Step**: Advance one generation manually
- **Clear**: Reset the entire grid to empty
- **Randomize**: Fill grid with random living cells (30% density)
- **Speed Slider**: Adjust simulation speed (10-1000ms per generation)

### Drawing Tools
- **Single Pixel**: Toggle individual cells with mouse clicks
- **Draw Line**: Click and drag to draw straight lines with preview
- **Brush**: Paint with adjustable brush size (1-10 pixels)

### Grid Configuration
- **Width/Height Inputs**: Set grid dimensions (10-2000 cells)
- **Apply Grid Button**: Resize the grid with validation
- **Auto-correction**: Invalid inputs automatically restore to last valid values
- **Enter Key Support**: Press Enter in input fields to apply changes

### Pattern Library
- **Load Patterns**: Choose from 7 pre-defined Conway's Game of Life patterns
- **One-click Loading**: Patterns are automatically scaled and centered

### Interface Features
- **Generation Counter**: Track simulation progress
- **FPS Counter**: Monitor rendering performance
- **Draw Mode Indicator**: Shows current drawing tool
- **Terminal-style Theme**: Dark interface with green accent colors

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.
