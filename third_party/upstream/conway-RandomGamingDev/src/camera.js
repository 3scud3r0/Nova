function applyCamera() {
  translate(width / 2, height / 2); 
  
  translate(camPos.ind(0), camPos.ind(1));
  scale(camFOV, camFOV);
  strokeWeight(1/camFOV);
}

function mouseWheel(event) {
  const newFOV = camFOV - event.delta / 1000;
  
  if (newFOV < 0)
    return;
    
  camFOV = newFOV;
  camPos.addVec(MousePos()
                .mulNum(event.delta / 1000));
  event.stopPropagation();
}

function windowResized() {
  let smallest = windowHeight;
  if (windowWidth < windowHeight)
    smallest = windowWidth;
  resizeCanvas(smallest, smallest);
}
