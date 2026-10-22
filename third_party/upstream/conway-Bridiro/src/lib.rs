use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use web_sys::{WebGlBuffer, WebGlFramebuffer, WebGlProgram, WebGlRenderingContext, WebGlTexture};

mod patterns;
mod shaders;
mod texture;
mod webgl;

use patterns::Pattern;
use texture::TextureManager;

#[wasm_bindgen]
pub struct GameOfLife {
    gl: WebGlRenderingContext,
    compute_program: WebGlProgram,
    render_program: WebGlProgram,
    current_state: WebGlTexture,
    next_state: WebGlTexture,
    quad_buffer: WebGlBuffer,
    framebuffer: WebGlFramebuffer,
    texture_manager: TextureManager,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl GameOfLife {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas_id: &str, width: u32, height: u32) -> Result<GameOfLife, JsValue> {
        let gl = webgl::init_webgl_context(canvas_id)?;

        let current_state = webgl::create_texture(&gl, width, height)?;
        let next_state = webgl::create_texture(&gl, width, height)?;

        let framebuffer = gl
            .create_framebuffer()
            .ok_or_else(|| JsValue::from_str("Failed to create framebuffer"))?;

        let quad_buffer = webgl::create_quad_buffer(&gl)?;

        let compute_program = shaders::create_compute_program(&gl)?;
        let render_program = shaders::create_render_program(&gl)?;

        let texture_manager = TextureManager::new(gl.clone(), width, height);

        let game = GameOfLife {
            gl,
            compute_program,
            render_program,
            current_state,
            next_state,
            quad_buffer,
            framebuffer,
            texture_manager,
            width,
            height,
        };

        Ok(game)
    }

    #[wasm_bindgen]
    pub fn randomize(&mut self) -> Result<(), JsValue> {
        let data = self.texture_manager.create_random_data(0.3);
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn clear(&mut self) -> Result<(), JsValue> {
        let data = vec![0u8; (self.width * self.height * 4) as usize];
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn load_glider(&mut self) -> Result<(), JsValue> {
        let pattern = Pattern::glider();
        let positions = pattern.scaled_for_grid(self.width, self.height);
        let data = self.texture_manager.create_pattern_data(&positions);
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn load_oscillator(&mut self) -> Result<(), JsValue> {
        let pattern = Pattern::blinker();
        let positions = pattern.scaled_for_grid(self.width, self.height);
        let data = self.texture_manager.create_pattern_data(&positions);
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn load_beacon(&mut self) -> Result<(), JsValue> {
        let pattern = Pattern::beacon();
        let positions = pattern.scaled_for_grid(self.width, self.height);
        let data = self.texture_manager.create_pattern_data(&positions);
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn load_toad(&mut self) -> Result<(), JsValue> {
        let pattern = Pattern::toad();
        let positions = pattern.scaled_for_grid(self.width, self.height);
        let data = self.texture_manager.create_pattern_data(&positions);
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn load_spaceship(&mut self) -> Result<(), JsValue> {
        let pattern = Pattern::lightweight_spaceship();
        let positions = pattern.scaled_for_grid(self.width, self.height);
        let data = self.texture_manager.create_pattern_data(&positions);
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn load_pulsar(&mut self) -> Result<(), JsValue> {
        let pattern = Pattern::pulsar();
        let positions = pattern.scaled_for_grid(self.width, self.height);
        let data = self.texture_manager.create_pattern_data(&positions);
        self.upload_texture_data(data)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn load_glider_gun(&mut self) -> Result<(), JsValue> {
        let pattern = Pattern::gospel_glider_gun();
        let positions = pattern.scaled_for_grid(self.width, self.height);
        let data = self.texture_manager.create_pattern_data(&positions);
        self.upload_texture_data(data)?;
        Ok(())
    }

    fn upload_texture_data(&mut self, data: Vec<u8>) -> Result<(), JsValue> {
        // Recreate textures with new data
        self.current_state = webgl::create_texture(&self.gl, self.width, self.height)?;
        self.texture_manager
            .upload_data(&self.current_state, &data)?;

        self.next_state = webgl::create_texture(&self.gl, self.width, self.height)?;
        self.texture_manager.upload_data(&self.next_state, &data)?;

        Ok(())
    }

    #[wasm_bindgen]
    pub fn step(&mut self) -> Result<(), JsValue> {
        self.gl
            .bind_framebuffer(WebGlRenderingContext::FRAMEBUFFER, Some(&self.framebuffer));
        self.gl.framebuffer_texture_2d(
            WebGlRenderingContext::FRAMEBUFFER,
            WebGlRenderingContext::COLOR_ATTACHMENT0,
            WebGlRenderingContext::TEXTURE_2D,
            Some(&self.next_state),
            0,
        );

        self.gl
            .viewport(0, 0, self.width as i32, self.height as i32);
        self.gl.use_program(Some(&self.compute_program));

        self.gl.active_texture(WebGlRenderingContext::TEXTURE0);
        self.gl
            .bind_texture(WebGlRenderingContext::TEXTURE_2D, Some(&self.current_state));

        let texture_location = self
            .gl
            .get_uniform_location(&self.compute_program, "u_texture");
        self.gl.uniform1i(texture_location.as_ref(), 0);

        let resolution_location = self
            .gl
            .get_uniform_location(&self.compute_program, "u_resolution");
        self.gl.uniform2f(
            resolution_location.as_ref(),
            self.width as f32,
            self.height as f32,
        );

        self.gl
            .bind_buffer(WebGlRenderingContext::ARRAY_BUFFER, Some(&self.quad_buffer));
        let position_location = self
            .gl
            .get_attrib_location(&self.compute_program, "a_position");
        self.gl.enable_vertex_attrib_array(position_location as u32);
        self.gl.vertex_attrib_pointer_with_i32(
            position_location as u32,
            2,
            WebGlRenderingContext::FLOAT,
            false,
            0,
            0,
        );

        self.gl.draw_arrays(WebGlRenderingContext::TRIANGLES, 0, 6);

        std::mem::swap(&mut self.current_state, &mut self.next_state);

        Ok(())
    }

    #[wasm_bindgen]
    pub fn render(&self) -> Result<(), JsValue> {
        self.gl
            .bind_framebuffer(WebGlRenderingContext::FRAMEBUFFER, None);

        let canvas = web_sys::window()
            .unwrap()
            .document()
            .unwrap()
            .get_element_by_id("gameCanvas")
            .unwrap();
        let canvas: web_sys::HtmlCanvasElement =
            canvas.dyn_into::<web_sys::HtmlCanvasElement>().unwrap();

        self.gl
            .viewport(0, 0, canvas.width() as i32, canvas.height() as i32);
        self.gl.use_program(Some(&self.render_program));

        self.gl.clear_color(0.1, 0.1, 0.1, 1.0);
        self.gl.clear(WebGlRenderingContext::COLOR_BUFFER_BIT);

        self.gl.active_texture(WebGlRenderingContext::TEXTURE0);
        self.gl
            .bind_texture(WebGlRenderingContext::TEXTURE_2D, Some(&self.current_state));

        let texture_location = self
            .gl
            .get_uniform_location(&self.render_program, "u_texture");
        if texture_location.is_none() {
            return Err(JsValue::from_str("u_texture uniform not found"));
        }

        self.gl.uniform1i(texture_location.as_ref(), 0);

        self.gl
            .bind_buffer(WebGlRenderingContext::ARRAY_BUFFER, Some(&self.quad_buffer));
        let position_location = self
            .gl
            .get_attrib_location(&self.render_program, "a_position");
        if position_location == -1 {
            return Err(JsValue::from_str("a_position attribute not found"));
        }

        self.gl.enable_vertex_attrib_array(position_location as u32);
        self.gl.vertex_attrib_pointer_with_i32(
            position_location as u32,
            2,
            WebGlRenderingContext::FLOAT,
            false,
            0,
            0,
        );

        self.gl.draw_arrays(WebGlRenderingContext::TRIANGLES, 0, 6);

        let error = self.gl.get_error();
        if error != WebGlRenderingContext::NO_ERROR {
            web_sys::console::log_1(&format!("WebGL error: {}", error).into());
        }

        Ok(())
    }

    #[wasm_bindgen]
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        self.width = width;
        self.height = height;

        self.current_state = webgl::create_texture(&self.gl, width, height)?;
        self.next_state = webgl::create_texture(&self.gl, width, height)?;

        self.texture_manager = TextureManager::new(self.gl.clone(), width, height);

        self.clear()?;

        Ok(())
    }

    #[wasm_bindgen]
    pub fn toggle_cell(&mut self, x: u32, y: u32) -> Result<(), JsValue> {
        if x >= self.width || y >= self.height {
            return Ok(());
        }

        self.set_cell(x, y, 255)?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn set_cell(&mut self, x: u32, y: u32, alive: u8) -> Result<(), JsValue> {
        if x >= self.width || y >= self.height {
            return Ok(());
        }

        self.gl
            .bind_texture(WebGlRenderingContext::TEXTURE_2D, Some(&self.current_state));

        let data = [alive, alive, alive, 255];

        self.gl
            .tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
                WebGlRenderingContext::TEXTURE_2D,
                0,
                x as i32,
                y as i32,
                1,
                1,
                WebGlRenderingContext::RGBA,
                WebGlRenderingContext::UNSIGNED_BYTE,
                Some(&data),
            )?;

        Ok(())
    }

    #[wasm_bindgen]
    pub fn draw_line(&mut self, x1: u32, y1: u32, x2: u32, y2: u32) -> Result<(), JsValue> {
        // Bresenham's line algorithm
        let mut x0 = x1 as i32;
        let mut y0 = y1 as i32;
        let x_end = x2 as i32;
        let y_end = y2 as i32;

        let dx = (x_end - x0).abs();
        let dy = -(y_end - y0).abs();
        let sx = if x0 < x_end { 1 } else { -1 };
        let sy = if y0 < y_end { 1 } else { -1 };
        let mut err = dx + dy;

        loop {
            if x0 >= 0 && y0 >= 0 && (x0 as u32) < self.width && (y0 as u32) < self.height {
                self.set_cell(x0 as u32, y0 as u32, 255)?;
            }

            if x0 == x_end && y0 == y_end {
                break;
            }

            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x0 += sx;
            }
            if e2 <= dx {
                err += dx;
                y0 += sy;
            }
        }

        Ok(())
    }

    #[wasm_bindgen]
    pub fn add_cells_in_area(
        &mut self,
        center_x: u32,
        center_y: u32,
        radius: u32,
    ) -> Result<(), JsValue> {
        self.texture_manager
            .add_cells_in_area(&self.current_state, center_x, center_y, radius)?;
        Ok(())
    }
}
