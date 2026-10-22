use wasm_bindgen::prelude::*;
use web_sys::{WebGlProgram, WebGlRenderingContext};

use crate::webgl::create_shader;

pub fn create_compute_program(gl: &WebGlRenderingContext) -> Result<WebGlProgram, JsValue> {
    let vertex_shader_source = r#"
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
        }
    "#;

    let fragment_shader_source = r#"
        precision mediump float;
        uniform sampler2D u_texture;
        uniform vec2 u_resolution;
        varying vec2 v_texCoord;
        
        int getCell(vec2 coord) {
            vec2 wrappedCoord = fract(coord);
            vec4 cell = texture2D(u_texture, wrappedCoord);
            return cell.r > 0.5 ? 1 : 0;
        }
        
        void main() {
            vec2 texelSize = 1.0 / u_resolution;
            vec2 coord = v_texCoord;
            
            int current = getCell(coord);
            
            int neighbors = 0;
            neighbors += getCell(coord + vec2(-1.0, -1.0) * texelSize);
            neighbors += getCell(coord + vec2( 0.0, -1.0) * texelSize);
            neighbors += getCell(coord + vec2( 1.0, -1.0) * texelSize);
            neighbors += getCell(coord + vec2(-1.0,  0.0) * texelSize);
            neighbors += getCell(coord + vec2( 1.0,  0.0) * texelSize);
            neighbors += getCell(coord + vec2(-1.0,  1.0) * texelSize);
            neighbors += getCell(coord + vec2( 0.0,  1.0) * texelSize);
            neighbors += getCell(coord + vec2( 1.0,  1.0) * texelSize);
            
            int newState = 0;
            if (current == 1) {
                if (neighbors == 2 || neighbors == 3) {
                    newState = 1;
                }
            } else {
                if (neighbors == 3) {
                    newState = 1;
                }
            }
            
            gl_FragColor = vec4(vec3(float(newState)), 1.0);
        }
    "#;

    let vertex_shader = create_shader(
        gl,
        WebGlRenderingContext::VERTEX_SHADER,
        vertex_shader_source,
    )?;
    let fragment_shader = create_shader(
        gl,
        WebGlRenderingContext::FRAGMENT_SHADER,
        fragment_shader_source,
    )?;

    let program = gl
        .create_program()
        .ok_or_else(|| JsValue::from_str("Failed to create program"))?;

    gl.attach_shader(&program, &vertex_shader);
    gl.attach_shader(&program, &fragment_shader);
    gl.link_program(&program);

    if gl
        .get_program_parameter(&program, WebGlRenderingContext::LINK_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(program)
    } else {
        Err(JsValue::from_str(
            &gl.get_program_info_log(&program)
                .unwrap_or_else(|| "Unknown error linking program".into()),
        ))
    }
}

pub fn create_render_program(gl: &WebGlRenderingContext) -> Result<WebGlProgram, JsValue> {
    let vertex_shader_source = r#"
        attribute vec2 a_position;
        varying vec2 v_texCoord;
        
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_position * 0.5 + 0.5;
        }
    "#;

    let fragment_shader_source = r#"
        precision mediump float;
        uniform sampler2D u_texture;
        varying vec2 v_texCoord;
        
        void main() {
            vec4 texColor = texture2D(u_texture, v_texCoord);
            gl_FragColor = vec4(texColor.rgb, 1.0);
        }
    "#;

    let vertex_shader = create_shader(
        gl,
        WebGlRenderingContext::VERTEX_SHADER,
        vertex_shader_source,
    )?;
    let fragment_shader = create_shader(
        gl,
        WebGlRenderingContext::FRAGMENT_SHADER,
        fragment_shader_source,
    )?;

    let program = gl
        .create_program()
        .ok_or_else(|| JsValue::from_str("Failed to create program"))?;

    gl.attach_shader(&program, &vertex_shader);
    gl.attach_shader(&program, &fragment_shader);
    gl.link_program(&program);

    if gl
        .get_program_parameter(&program, WebGlRenderingContext::LINK_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(program)
    } else {
        Err(JsValue::from_str(
            &gl.get_program_info_log(&program)
                .unwrap_or_else(|| "Unknown error linking program".into()),
        ))
    }
}
