var mouseDown = false;
document.body.onmousedown = () => mouseDown = true;
document.body.onmouseup = () => mouseDown = false;

function place() {
  const mousePos = MousePos();
  
  if (!mouseDown)
    return;
    
  const mousePlacePos = mousePos.copy()
                        .divVec(CanvasDim())
                        .mulVec(BufferDim())
                        .subVec(cursorSize.copy().divNum(2))
                        .round();
  
  const buffer = buffers[Number(!curBuf)];
  buffer.push();
  {
    buffer.fill(placing ? aliveCellColor : deadCellColor);
    buffer.noStroke();
    if (pasteImage == null)
      buffer.rect(mousePlacePos.ind(0), mousePlacePos.ind(1),
                  cursorSize.ind(0), cursorSize.ind(1));
    else
      buffer.image(pasteImage,
                    mousePlacePos.ind(0), mousePlacePos.ind(1),
                    cursorSize.ind(0), cursorSize.ind(1));
  }
  buffer.pop();
}