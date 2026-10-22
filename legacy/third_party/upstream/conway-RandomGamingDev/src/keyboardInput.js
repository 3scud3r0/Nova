function handleToPaste(file) {
  if (file.type != "image")
    return;

  pasteImage = loadImage(file.data, (img) => {
    cursorSize = Vec.fromList([img.width, img.height]);
  });
}

function keyPressed() {
  switch (keyCode) {
    case 72: // h for help
      prompt(
      `- Use h for help
       - Use p to pause & play
       - Use m to switch between place & erase mode
       - Use t to set the tick speed per frame (60fps)
       - Use c to declare cursor size
       - Use r to declare a new canvas with a new size
       - Use s to save the world as a png
       - Use l for loading an image to paste (p was already used lmao)
       - Use esc to escape out of lay mode`)
      break;
      
    case 80: // p for pause/play
      running = !running;
      break;
      
    case 77: // m for mode aka erase/pen switch
      placing = !placing;
      break;
      
    case 84: // t for tick aka run speed
      {
        const result = Number(prompt(`Enter a speed (tick per frame at 60fps):`));
        if (isNaN(result)) {
          prompt("That was an illegal value. To enter the cursor please press T again.");
          return;
        }
        runSpeed = result;
      }
      break;
      
    case 67: // c for cursor size
      {
        let numResults = new Array(2);
        
        for (let i = 0; i < numResults.length; i++) {
          numResults[i] = Number(prompt(`Enter a new cursor ${dimNames[i]}:`));
          if (isNaN(numResults[i])) {
            prompt("That was an illegal value. To enter the cursor please press C again.");
            return; 
          }
        }
        cursorSize = Vec.fromList(numResults);
      }
      break;
      
    case 82: // r for resize
      {
        let numResults = new Array(2);
        
        for (let i = 0; i < numResults.length; i++) {
          numResults[i] = Number(prompt(`Enter a new world ${dimNames[i]} (2^<your input>) (BEWARE: this will reset your world & if the size is too large it will corrupt your world, but you can save it using S):`));
          if (isNaN(numResults[i])) {
            prompt("That was an illegal value. To enter the cursor please press R again.");
            return; 
          }
        }
        
        buffersInit(Vec.fromList(numResults));
      }
      break;
      
    case 83: // s for save mode to save part as a photo
      saveCanvas(buffers[Number(!curBuf)], prompt("Enter the name of the save:"), "png");
      break;
      
    case 27: // escape for escaping out of paste mode
      pasteImage = null;
      break;
      
    case 76: // l for loading an image to paste
      fileInput.click();
      break;
  }
}