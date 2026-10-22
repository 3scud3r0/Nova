use anyhow::Result;
pub use nova_automata::Rules;
pub fn compile(expression: &str, dimensions: u32) -> Result<Rules> {
    Rules::parse(expression, dimensions, 1)
}
