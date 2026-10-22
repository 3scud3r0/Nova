function step() {
  const ncurBuf = Number(curBuf);
  const oNcurBuf = Number(!curBuf);
  
  const buffer = buffers[ncurBuf];
  const oBuffer = buffers[oNcurBuf];
  
  const stepShader = stepShaders[ncurBuf];
  
  stepShader.setUniform("tex0", oBuffer);
  
  buffer.background(0);
  buffer.rect(0, 0, buffer.width, buffer.height);
  
  curBuf = !curBuf;
}

function steps() {
  nextRunTimer += runSpeed;
  if (nextRunTimer < 1)
      return;
      
  for (const i in buffers) {
    const buffer = buffers[i];
    const oBuffer = buffers[Number(!Boolean(i))]; 
    
    const stepShader = stepShaders[i];
    
    buffer.shader(stepShader);
    stepShader.setUniform("aliveCellColor", aliveCellColor);
    stepShader.setUniform("deadCellColor", deadCellColor);
    stepShader.setUniform("screenSize", BufferDim().list); 
  }
      
  push();
  {
    for (const buffer of buffers)
      buffer.noStroke();
  
    for (let i = 0; i < Math.floor(nextRunTimer); i++)
      step(); 
  }
  pop();
  
  for (const buffer of buffers)
    buffer.resetShader();
  
  nextRunTimer %= 1;
}
