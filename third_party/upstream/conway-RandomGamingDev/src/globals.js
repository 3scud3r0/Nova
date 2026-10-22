// consts
let fileInput; // eh it's practically a const
const signs = [-1, 1];
const dimNames = ["width", "height", "depth"];

let deadCellColor = [0, 0, 0, 1];
let aliveCellColor = [1, 1, 1, 1];
let removeCellColor = [1, 0, 0, 1];

// Buffer & buffer step vars
let curBuf = true;
let buffers = new Array(2);
let stepShaders = new Array(2);

// Cursor vars
let cursorSize = Vec.fromList([1, 1]);
let placing = true;
let pasteImage = null;

// Run speed
let running = false;
let runSpeed = 1;
let nextRunTimer = 0;

// "globals"
const TrueMousePos = () => Vec.fromList([mouseX, mouseY]);
const MousePos = () => TrueMousePos()
                        .subVec(CanvasDim().divNum(2))
                        .subVec(camPos).divNum(camFOV);
const CanvasDim = () => Vec.fromList([width, height]);
function BufferDim() {
  const buffer = buffers[0];
  return Vec.fromList([buffer.width, buffer.height]);
}
