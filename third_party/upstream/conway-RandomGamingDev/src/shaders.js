let vs = `
  attribute vec3 aPosition;
  attribute vec2 aTexCoord;

  varying vec2 vTexCoord;

  void main() {
    vTexCoord = aTexCoord;
    vec4 pos = vec4(aPosition, 1.0);
    pos.xy = pos.xy * 2.0 - 1.0;
    pos.z = 1.0;
    gl_Position = pos;
  }
`;

let fs = ` 
  #ifdef GL_ES
  precision mediump float;
  #endif

  varying vec2 vTexCoord;

  uniform sampler2D tex0;

  #define SIGNS_SIZE 2
  int signs[SIGNS_SIZE];

  uniform vec4 aliveCellColor;
  uniform vec4 deadCellColor;
  uniform vec2 screenSize;
  vec2 pixSize = vec2(1) / screenSize;

  #define IsAlive(coord) texture2D(tex0, coord) == aliveCellColor

  #define NumNeigh(coord, toReturn) {\
    for (int i = 0; i < SIGNS_SIZE; i++) {\
      vec2 signOff = pixSize * vec2(signs[i]);\
      \
      {\
        vec2 xOffCoord = coord;\
        xOffCoord.x += signOff.x;\
        for (int j = -1; j < 2; j++) {\
          vec2 offCoord = xOffCoord;\
          offCoord.y += pixSize.y * float(j);\
          if (IsAlive(offCoord))\
            toReturn++;\
        }\
      }\
      \
      {\
        vec2 yOffCoord = coord;\
        yOffCoord.y += signOff.y;\
        if (IsAlive(yOffCoord))\
          toReturn++;\
      }\
    }\
  }

  void main() {
    signs[0] = -1;
    signs[1] = 1;

    vec2 coord = vTexCoord;
    coord.y = 1.0 - coord.y;
    bool isAlive = IsAlive(coord);
    int numNeigh = 0;
    NumNeigh(coord, numNeigh);

    if (numNeigh == 3)
      gl_FragColor = aliveCellColor;
    else if (isAlive && numNeigh == 2)
      gl_FragColor = aliveCellColor;
    else
      gl_FragColor = deadCellColor;
  }
`;