#[derive(Clone)]
pub struct Pattern {
    pub cells: Vec<(i32, i32)>,
    pub name: &'static str,
}

impl Pattern {
    pub fn glider() -> Self {
        Pattern {
            cells: vec![(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)],
            name: "Glider",
        }
    }

    pub fn blinker() -> Self {
        Pattern {
            cells: vec![(-1, 0), (0, 0), (1, 0)],
            name: "Blinker",
        }
    }

    pub fn beacon() -> Self {
        Pattern {
            cells: vec![(0, 0), (1, 0), (0, 1), (3, 2), (2, 3), (3, 3)],
            name: "Beacon",
        }
    }

    pub fn toad() -> Self {
        Pattern {
            cells: vec![(1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1)],
            name: "Toad",
        }
    }

    pub fn lightweight_spaceship() -> Self {
        Pattern {
            cells: vec![
                (0, 1),
                (3, 1),
                (4, 2),
                (0, 3),
                (4, 3),
                (1, 4),
                (2, 4),
                (3, 4),
                (4, 4),
            ],
            name: "Lightweight Spaceship",
        }
    }

    pub fn pulsar() -> Self {
        let mut cells = Vec::new();

        for x in 2..=4 {
            cells.push((x, 0));
        }
        for x in 8..=10 {
            cells.push((x, 0));
        }

        cells.push((1, 2));
        cells.push((5, 2));
        cells.push((7, 2));
        cells.push((11, 2));
        cells.push((1, 3));
        cells.push((5, 3));
        cells.push((7, 3));
        cells.push((11, 3));
        cells.push((1, 4));
        cells.push((5, 4));
        cells.push((7, 4));
        cells.push((11, 4));

        for x in 2..=4 {
            cells.push((x, 5));
        }
        for x in 8..=10 {
            cells.push((x, 5));
        }
        for x in 2..=4 {
            cells.push((x, 7));
        }
        for x in 8..=10 {
            cells.push((x, 7));
        }

        cells.push((1, 8));
        cells.push((5, 8));
        cells.push((7, 8));
        cells.push((11, 8));
        cells.push((1, 9));
        cells.push((5, 9));
        cells.push((7, 9));
        cells.push((11, 9));
        cells.push((1, 10));
        cells.push((5, 10));
        cells.push((7, 10));
        cells.push((11, 10));

        for x in 2..=4 {
            cells.push((x, 12));
        }
        for x in 8..=10 {
            cells.push((x, 12));
        }

        Pattern {
            cells,
            name: "Pulsar",
        }
    }

    pub fn gospel_glider_gun() -> Self {
        let cells = vec![
            (0, 4),
            (0, 5),
            (1, 4),
            (1, 5),
            (10, 4),
            (10, 5),
            (10, 6),
            (11, 3),
            (11, 7),
            (12, 2),
            (12, 8),
            (13, 2),
            (13, 8),
            (14, 5),
            (15, 3),
            (15, 7),
            (16, 4),
            (16, 5),
            (16, 6),
            (17, 5),
            (20, 2),
            (20, 3),
            (20, 4),
            (21, 2),
            (21, 3),
            (21, 4),
            (22, 1),
            (22, 5),
            (24, 0),
            (24, 1),
            (24, 5),
            (24, 6),
            (34, 2),
            (34, 3),
            (35, 2),
            (35, 3),
        ];

        Pattern {
            cells,
            name: "Gosper Glider Gun",
        }
    }

    pub fn scaled_for_grid(&self, grid_width: u32, grid_height: u32) -> Vec<(u32, u32)> {
        let center_x = grid_width / 2;
        let center_y = grid_height / 2;

        let min_dimension = grid_width.min(grid_height);

        if min_dimension >= 200 {
            match self.name {
                "Glider" => {
                    let mut positions = Vec::new();
                    let offsets = [(-30, -30), (30, -30), (-30, 30), (30, 30)];

                    for (offset_x, offset_y) in offsets.iter() {
                        for (dx, dy) in &self.cells {
                            let x = center_x as i32 + dx + offset_x;
                            let y = center_y as i32 + dy + offset_y;

                            if x >= 0
                                && y >= 0
                                && (x as u32) < grid_width
                                && (y as u32) < grid_height
                            {
                                positions.push((x as u32, y as u32));
                            }
                        }
                    }
                    return positions;
                }
                "Gosper Glider Gun" => {
                    return self
                        .cells
                        .iter()
                        .filter_map(|(dx, dy)| {
                            let x = center_x as i32 + dx;
                            let y = center_y as i32 + dy;

                            if x >= 0
                                && y >= 0
                                && (x as u32) < grid_width
                                && (y as u32) < grid_height
                            {
                                Some((x as u32, y as u32))
                            } else {
                                None
                            }
                        })
                        .collect();
                }
                _ => {}
            }
        }

        self.cells
            .iter()
            .filter_map(|(dx, dy)| {
                let x = center_x as i32 + dx;
                let y = center_y as i32 + dy;

                if x >= 0 && y >= 0 && (x as u32) < grid_width && (y as u32) < grid_height {
                    Some((x as u32, y as u32))
                } else {
                    None
                }
            })
            .collect()
    }
}
