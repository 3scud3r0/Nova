function render() {    
  // The buffer that was rendered to last frame and being rendered from this frame
  background(0.5);
  push();
  {
    fill(0);
    rect(-width / 2, -height / 2, width, height); 
  }
  pop();
  image(buffers[Number(!curBuf)], -width / 2, -height / 2, width, height);
  
  const cursorOutSize = cursorSize.copy()
                          .divVec(BufferDim())
                          .mulVec(CanvasDim());
  const cursorOutPos = MousePos().copy()
                        .divVec(CanvasDim())
                        .mulVec(BufferDim())
                        .subVec(cursorSize.copy().divNum(2))
                        .round()
                        .divVec(BufferDim())
                        .mulVec(CanvasDim())
  
  // The cursor outline
  push();
  {
    noFill();
    stroke(placing ? aliveCellColor : removeCellColor);
    rect(cursorOutPos.ind(0), cursorOutPos.ind(1), 
           cursorOutSize.ind(0), cursorOutSize.ind(1));
    if (pasteImage != null) {
      push();
      {
        tint(1, 0.5);
        image(pasteImage,
            cursorOutPos.ind(0), cursorOutPos.ind(1),
            cursorOutSize.ind(0), cursorOutSize.ind(1)); 
      }
      pop();
    }
  }
  pop();
}