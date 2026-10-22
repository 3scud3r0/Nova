use wasm_bindgen::prelude::*;
use web_sys::{WebGlBuffer, WebGlRenderingContext, WebGlShader, WebGlTexture};

pub fn init_webgl_context(canvas_id: &str) -> Result<WebGlRenderingContext, JsValue> {
    let document = web_sys::window().unwrap().document().unwrap();
    let canvas = document.get_element_by_id(canvas_id).unwrap();
    let canvas: web_sys::HtmlCanvasElement = canvas.dyn_into::<web_sys::HtmlCanvasElement>()?;
    let gl: WebGlRenderingContext = canvas
        .get_context("webgl")?
        .unwrap()
        .dyn_into::<WebGlRenderingContext>()
        .unwrap();

    gl.viewport(0, 0, canvas.width() as i32, canvas.height() as i32);
    gl.get_extension("OES_texture_float").ok();

    Ok(gl)
}

pub fn create_texture(
    gl: &WebGlRenderingContext,
    width: u32,
    height: u32,
) -> Result<WebGlTexture, JsValue> {
    let texture = gl
        .create_texture()
        .ok_or_else(|| JsValue::from_str("Failed to create texture"))?;

    gl.bind_texture(WebGlRenderingContext::TEXTURE_2D, Some(&texture));

    let data = vec![0u8; (width * height * 4) as usize];
    gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
        WebGlRenderingContext::TEXTURE_2D,
        0,
        WebGlRenderingContext::RGBA as i32,
        width as i32,
        height as i32,
        0,
        WebGlRenderingContext::RGBA,
        WebGlRenderingContext::UNSIGNED_BYTE,
        Some(&data),
    )?;

    gl.tex_parameteri(
        WebGlRenderingContext::TEXTURE_2D,
        WebGlRenderingContext::TEXTURE_MIN_FILTER,
        WebGlRenderingContext::NEAREST as i32,
    );
    gl.tex_parameteri(
        WebGlRenderingContext::TEXTURE_2D,
        WebGlRenderingContext::TEXTURE_MAG_FILTER,
        WebGlRenderingContext::NEAREST as i32,
    );
    gl.tex_parameteri(
        WebGlRenderingContext::TEXTURE_2D,
        WebGlRenderingContext::TEXTURE_WRAP_S,
        WebGlRenderingContext::CLAMP_TO_EDGE as i32,
    );
    gl.tex_parameteri(
        WebGlRenderingContext::TEXTURE_2D,
        WebGlRenderingContext::TEXTURE_WRAP_T,
        WebGlRenderingContext::CLAMP_TO_EDGE as i32,
    );

    Ok(texture)
}

pub fn create_quad_buffer(gl: &WebGlRenderingContext) -> Result<WebGlBuffer, JsValue> {
    let buffer = gl
        .create_buffer()
        .ok_or_else(|| JsValue::from_str("Failed to create buffer"))?;

    let vertices: [f32; 12] = [
        -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
    ];

    gl.bind_buffer(WebGlRenderingContext::ARRAY_BUFFER, Some(&buffer));
    let vertices_array = unsafe { js_sys::Float32Array::view(&vertices) };
    gl.buffer_data_with_array_buffer_view(
        WebGlRenderingContext::ARRAY_BUFFER,
        &vertices_array,
        WebGlRenderingContext::STATIC_DRAW,
    );

    Ok(buffer)
}

pub fn create_shader(
    gl: &WebGlRenderingContext,
    shader_type: u32,
    source: &str,
) -> Result<WebGlShader, JsValue> {
    let shader = gl
        .create_shader(shader_type)
        .ok_or_else(|| JsValue::from_str("Unable to create shader object"))?;

    gl.shader_source(&shader, source);
    gl.compile_shader(&shader);

    if gl
        .get_shader_parameter(&shader, WebGlRenderingContext::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false)
    {
        Ok(shader)
    } else {
        let error_log = gl
            .get_shader_info_log(&shader)
            .unwrap_or_else(|| "Unknown error creating shader".into());
        web_sys::console::log_1(&format!("Shader compilation error: {}", error_log).into());
        Err(JsValue::from_str(&error_log))
    }
}
