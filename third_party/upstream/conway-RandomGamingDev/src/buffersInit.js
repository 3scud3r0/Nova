function buffersInit(size) {
  const pixSize = size.numPow(2);
  
  for (let i = 0; i < buffers.length; i++) {
    // buffer creation
    buffers[i] = createGraphics(pixSize.ind(0), pixSize.ind(1), WEBGL);
    const buffer = buffers[i];
    buffer.pixelDensity(1);
    buffer.colorMode(RGB, 1);
    buffer.textureWrap(REPEAT);
    buffer.background(0);
    
    // shader creation
    stepShaders[i] = buffer.createShader(vs, fs);
  }
}