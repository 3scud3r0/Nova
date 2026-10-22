function setup() {
  fileInput = createFileInput(handleToPaste).hide().elt
 
  createCanvas(400, 400);
  windowResized();
  frameRate(60);
  noSmooth();
  colorMode(RGB, 1);
  
  buffersInit(Vec.fromList([5, 5]));
}

let camPos = Vec.fromList([0, 0]);
let camFOV = 1;

function draw() {
  applyCamera();
  
  place();
  render();
  if (running)
    steps();
}
