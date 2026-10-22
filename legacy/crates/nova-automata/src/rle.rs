//! Bounded standard 2D Life RLE import/export for native editing and interchange.
use crate::Grid;
use anyhow::{ensure, Result};
pub fn import(grid: &mut Grid, text: &str, origin: [isize; 2]) -> Result<()> {
    ensure!(
        grid.rules.dimensions == 2 && text.len() <= 4 * 1024 * 1024,
        "bounded 2D RLE required"
    );
    let data = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.starts_with('#') && !l.starts_with('x') && !l.is_empty())
        .collect::<String>();
    let (mut x, mut y, mut count) = (0isize, 0isize, 0usize);
    let mut ended = false;
    for ch in data.chars() {
        if ch.is_ascii_whitespace() {
            continue;
        }
        if let Some(d) = ch.to_digit(10) {
            count = count
                .checked_mul(10)
                .and_then(|n| n.checked_add(d as usize))
                .ok_or_else(|| anyhow::anyhow!("RLE run overflow"))?;
            ensure!(count <= grid.cells.len(), "RLE run exceeds cell budget");
            continue;
        }
        let run = count.max(1);
        count = 0;
        match ch {
            'b' | 'o' => {
                ensure!(
                    (x as usize)
                        .checked_add(run)
                        .is_some_and(|n| n <= grid.shape[0]),
                    "RLE row exceeds target width"
                );
                if ch == 'o' {
                    for i in 0..run {
                        grid.set([origin[0] + x + i as isize, origin[1] + y, 0], true);
                    }
                }
                x += run as isize;
            }
            '$' => {
                y += run as isize;
                ensure!(y < (grid.shape[1] as isize), "RLE exceeds target height");
                x = 0;
            }
            '!' => {
                ended = true;
                break;
            }
            _ => anyhow::bail!("invalid RLE token"),
        }
    }
    ensure!(ended, "RLE missing terminator");
    Ok(())
}
pub fn export(grid: &Grid) -> Result<String> {
    ensure!(grid.rules.dimensions == 2, "RLE export is 2D");
    grid.validate()?;
    let mut out = format!(
        "#C NOVA native generation {}\nx = {}, y = {}\n",
        grid.tick, grid.shape[0], grid.shape[1]
    );
    for y in 0..grid.shape[1] {
        let mut start = 0;
        while start < grid.shape[0] {
            let alive = grid.cells[y * grid.shape[0] + start];
            let mut end = start + 1;
            while end < grid.shape[0] && grid.cells[y * grid.shape[0] + end] == alive {
                end += 1;
            }
            let n = end - start;
            if n > 1 {
                out.push_str(&n.to_string());
            }
            out.push(if alive == 0 { 'b' } else { 'o' });
            start = end;
        }
        if y + 1 < grid.shape[1] {
            out.push('$');
        }
    }
    out.push('!');
    out.push('\n');
    Ok(out)
}
