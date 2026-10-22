use wasm_bindgen::prelude::*;
use web_sys::{WebGlRenderingContext, WebGlTexture};

pub struct TextureManager {
    gl: WebGlRenderingContext,
    width: u32,
    height: u32,
}

impl TextureManager {
    pub fn new(gl: WebGlRenderingContext, width: u32, height: u32) -> Self {
        Self { gl, width, height }
    }

    pub fn upload_data(&self, texture: &WebGlTexture, data: &[u8]) -> Result<(), JsValue> {
        self.gl
            .bind_texture(WebGlRenderingContext::TEXTURE_2D, Some(texture));

        let result = self
            .gl
            .tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
                WebGlRenderingContext::TEXTURE_2D,
                0,
                WebGlRenderingContext::RGBA as i32,
                self.width as i32,
                self.height as i32,
                0,
                WebGlRenderingContext::RGBA,
                WebGlRenderingContext::UNSIGNED_BYTE,
                Some(data),
            );

        if let Err(e) = result {
            return Err(e);
        }

        self.set_texture_parameters();
        self.gl
            .bind_texture(WebGlRenderingContext::TEXTURE_2D, None);

        Ok(())
    }

    pub fn create_pattern_data(&self, positions: &[(u32, u32)]) -> Vec<u8> {
        let mut data = vec![0u8; (self.width * self.height * 4) as usize];

        for &(x, y) in positions {
            if x < self.width && y < self.height {
                let index = ((y * self.width + x) * 4) as usize;
                data[index] = 255; // R
                data[index + 1] = 255; // G
                data[index + 2] = 255; // B
                data[index + 3] = 255; // A
            }
        }

        data
    }

    pub fn create_random_data(&self, density: f64) -> Vec<u8> {
        let mut data = vec![0u8; (self.width * self.height * 4) as usize];

        for y in 0..self.height {
            for x in 0..self.width {
                let index = ((y * self.width + x) * 4) as usize;

                let is_alive = js_sys::Math::random() < density;
                let color = if is_alive { 255u8 } else { 0u8 };

                data[index] = color;
                data[index + 1] = color;
                data[index + 2] = color;
                data[index + 3] = 255;
            }
        }

        data
    }

    pub fn add_cells_in_area(
        &self,
        texture: &WebGlTexture,
        center_x: u32,
        center_y: u32,
        radius: u32,
    ) -> Result<(), JsValue> {
        self.gl
            .bind_texture(WebGlRenderingContext::TEXTURE_2D, Some(texture));

        let data = [255u8, 255, 255, 255];

        for dy in -(radius as i32)..=(radius as i32) {
            for dx in -(radius as i32)..=(radius as i32) {
                let x = center_x as i32 + dx;
                let y = center_y as i32 + dy;

                if x >= 0 && y >= 0 && (x as u32) < self.width && (y as u32) < self.height {
                    if dx * dx + dy * dy <= (radius as i32) * (radius as i32) {
                        self.gl
                            .tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
                                WebGlRenderingContext::TEXTURE_2D,
                                0,
                                x,
                                y,
                                1,
                                1,
                                WebGlRenderingContext::RGBA,
                                WebGlRenderingContext::UNSIGNED_BYTE,
                                Some(&data),
                            )?;
                    }
                }
            }
        }

        Ok(())
    }

    fn set_texture_parameters(&self) {
        self.gl.tex_parameteri(
            WebGlRenderingContext::TEXTURE_2D,
            WebGlRenderingContext::TEXTURE_MIN_FILTER,
            WebGlRenderingContext::NEAREST as i32,
        );
        self.gl.tex_parameteri(
            WebGlRenderingContext::TEXTURE_2D,
            WebGlRenderingContext::TEXTURE_MAG_FILTER,
            WebGlRenderingContext::NEAREST as i32,
        );
        self.gl.tex_parameteri(
            WebGlRenderingContext::TEXTURE_2D,
            WebGlRenderingContext::TEXTURE_WRAP_S,
            WebGlRenderingContext::CLAMP_TO_EDGE as i32,
        );
        self.gl.tex_parameteri(
            WebGlRenderingContext::TEXTURE_2D,
            WebGlRenderingContext::TEXTURE_WRAP_T,
            WebGlRenderingContext::CLAMP_TO_EDGE as i32,
        );
    }
}
