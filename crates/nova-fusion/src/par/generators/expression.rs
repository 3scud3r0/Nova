// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from paulrobello/par-particle-life @ 6f495dae5b2bbb65fdafd2b7b6dab59142dfdf02.
// Copyright Paul Robello. Original and license retained in third_party/upstream.
// Expression DSL for user-defined custom rule generators.
//
// Supports: i, j, n variables; +, -, *, /, % operators;
// ==, !=, <, >, <=, >= comparisons; ternary (?: );
// abs, sin, cos, random, min, max, pow functions.

use rand::{Rng, RngExt};
use std::fmt;

/// Expression AST node.
#[derive(Debug, Clone)]
pub enum Expr {
    Literal(f32),
    Var(Var),
    BinOp {
        op: BinOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    UnaryNeg(Box<Expr>),
    Ternary {
        cond: Box<Expr>,
        then_expr: Box<Expr>,
        else_expr: Box<Expr>,
    },
    Call {
        func: Func,
        args: Vec<Expr>,
    },
}

/// Variable identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Var {
    I,
    J,
    N,
}

/// Binary operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
}

/// Built-in function.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Func {
    Abs,
    Sin,
    Cos,
    Random,
    Min,
    Max,
    Pow,
}

/// Expression evaluation context.
#[derive(Debug, Clone, Copy)]
pub struct EvalContext {
    pub i: f32,
    pub j: f32,
    pub n: f32,
}

/// Expression error.
#[derive(Debug, Clone)]
pub enum ExprError {
    Parse(String),
    Eval(String),
}

impl fmt::Display for ExprError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExprError::Parse(msg) => write!(f, "Parse error: {msg}"),
            ExprError::Eval(msg) => write!(f, "Eval error: {msg}"),
        }
    }
}

impl std::error::Error for ExprError {}

/// Maximum nesting depth for the recursive-descent parser and evaluator.
/// Bounds stack usage on hostile or corrupt input (SEC-002 / ARC-005).
const MAX_EXPR_DEPTH: u32 = 256;

/// Maximum accepted input length for `Expr::parse`, in bytes.
/// A legitimate rule expression is at most a few hundred bytes; 4 KB is far
/// beyond any realistic use and rejects pathologically large inputs.
const MAX_EXPR_INPUT_LEN: usize = 4 * 1024;

impl Expr {
    /// Parse an expression string into an AST.
    pub fn parse(input: &str) -> Result<Self, ExprError> {
        if input.len() > MAX_EXPR_INPUT_LEN {
            return Err(ExprError::Parse(format!(
                "expression input length {} exceeds maximum of {} bytes",
                input.len(),
                MAX_EXPR_INPUT_LEN
            )));
        }
        let tokens = tokenize(input)?;
        let mut parser = Parser::new(&tokens);
        let expr = parser.parse_expr(0)?;
        if parser.pos < tokens.len() {
            return Err(ExprError::Parse(format!(
                "Unexpected token '{}' at position {}",
                tokens[parser.pos].kind().display(),
                parser.pos
            )));
        }
        Ok(expr)
    }

    /// Evaluate the expression with the given context.
    ///
    /// `rng` drives the `random()` builtin so custom-generator matrices are
    /// reproducible across runs: callers pass a `seeded_rng()` so the same
    /// expression text always yields the same matrix.
    pub fn eval<R: Rng>(&self, ctx: &EvalContext, rng: &mut R) -> Result<f32, ExprError> {
        self.eval_depth(ctx, 0, rng)
    }

    fn eval_depth<R: Rng>(
        &self,
        ctx: &EvalContext,
        depth: u32,
        rng: &mut R,
    ) -> Result<f32, ExprError> {
        if depth > MAX_EXPR_DEPTH {
            return Err(ExprError::Eval("expression too deeply nested".into()));
        }
        match self {
            Expr::Literal(v) => Ok(*v),
            Expr::Var(Var::I) => Ok(ctx.i),
            Expr::Var(Var::J) => Ok(ctx.j),
            Expr::Var(Var::N) => Ok(ctx.n),
            Expr::BinOp { op, left, right } => {
                let l = left.eval_depth(ctx, depth + 1, rng)?;
                let r = right.eval_depth(ctx, depth + 1, rng)?;
                match op {
                    BinOp::Add => Ok(l + r),
                    BinOp::Sub => Ok(l - r),
                    BinOp::Mul => Ok(l * r),
                    BinOp::Div => {
                        if r == 0.0 {
                            Ok(0.0)
                        } else {
                            Ok(l / r)
                        }
                    }
                    BinOp::Mod => {
                        if r == 0.0 {
                            Ok(0.0)
                        } else {
                            Ok(l % r)
                        }
                    }
                    BinOp::Eq => Ok(if l == r { 1.0 } else { 0.0 }),
                    BinOp::Ne => Ok(if l != r { 1.0 } else { 0.0 }),
                    BinOp::Lt => Ok(if l < r { 1.0 } else { 0.0 }),
                    BinOp::Gt => Ok(if l > r { 1.0 } else { 0.0 }),
                    BinOp::Le => Ok(if l <= r { 1.0 } else { 0.0 }),
                    BinOp::Ge => Ok(if l >= r { 1.0 } else { 0.0 }),
                }
            }
            Expr::UnaryNeg(inner) => Ok(-inner.eval_depth(ctx, depth + 1, rng)?),
            Expr::Ternary {
                cond,
                then_expr,
                else_expr,
            } => {
                let c = cond.eval_depth(ctx, depth + 1, rng)?;
                if c != 0.0 {
                    then_expr.eval_depth(ctx, depth + 1, rng)
                } else {
                    else_expr.eval_depth(ctx, depth + 1, rng)
                }
            }
            Expr::Call { func, args } => eval_func(*func, args, ctx, depth + 1, rng),
        }
    }
}

fn eval_func<R: Rng>(
    func: Func,
    args: &[Expr],
    ctx: &EvalContext,
    depth: u32,
    rng: &mut R,
) -> Result<f32, ExprError> {
    match func {
        Func::Abs => {
            let v = expect_arg(func, args, 1, ctx, depth, rng)?;
            Ok(v[0].abs())
        }
        Func::Sin => {
            let v = expect_arg(func, args, 1, ctx, depth, rng)?;
            Ok(v[0].sin())
        }
        Func::Cos => {
            let v = expect_arg(func, args, 1, ctx, depth, rng)?;
            Ok(v[0].cos())
        }
        Func::Random => {
            let _ = expect_arg(func, args, 0, ctx, depth, rng)?;
            Ok(rng.random::<f32>() * 2.0 - 1.0)
        }
        Func::Min => {
            let v = expect_arg(func, args, 2, ctx, depth, rng)?;
            Ok(v[0].min(v[1]))
        }
        Func::Max => {
            let v = expect_arg(func, args, 2, ctx, depth, rng)?;
            Ok(v[0].max(v[1]))
        }
        Func::Pow => {
            let v = expect_arg(func, args, 2, ctx, depth, rng)?;
            let (base, exp) = (v[0], v[1]);
            // powf() on a negative base with a non-integral exponent yields NaN;
            // surface a clear error instead of poisoning the matrix (ARC-006).
            if base < 0.0 && exp.fract() != 0.0 {
                return Err(ExprError::Eval(format!(
                    "pow() of negative base ({base}) with non-integral exponent ({exp}) produces NaN"
                )));
            }
            Ok(base.powf(exp))
        }
    }
}

fn expect_arg<R: Rng>(
    func: Func,
    args: &[Expr],
    expected: usize,
    ctx: &EvalContext,
    depth: u32,
    rng: &mut R,
) -> Result<Vec<f32>, ExprError> {
    if args.len() != expected {
        return Err(ExprError::Eval(format!(
            "{func:?}() expects {expected} argument(s), got {}",
            args.len()
        )));
    }
    args.iter().map(|a| a.eval_depth(ctx, depth, rng)).collect()
}

// === Tokenizer ===

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f32),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
    Question,
    Colon,
    LParen,
    RParen,
    Comma,
}

impl Token {
    fn kind(&self) -> &Token {
        self
    }

    fn display(&self) -> &str {
        match self {
            Token::Number(_) => "number",
            Token::Ident(_) => "identifier",
            Token::Plus => "+",
            Token::Minus => "-",
            Token::Star => "*",
            Token::Slash => "/",
            Token::Percent => "%",
            Token::Eq => "==",
            Token::Ne => "!=",
            Token::Lt => "<",
            Token::Gt => ">",
            Token::Le => "<=",
            Token::Ge => ">=",
            Token::Question => "?",
            Token::Colon => ":",
            Token::LParen => "(",
            Token::RParen => ")",
            Token::Comma => ",",
        }
    }
}

fn tokenize(input: &str) -> Result<Vec<Token>, ExprError> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }

        if ch.is_ascii_digit() || ch == '.' {
            let mut num_str = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_ascii_digit() || c == '.' {
                    num_str.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            let val: f32 = num_str
                .parse()
                .map_err(|e| ExprError::Parse(format!("Invalid number '{num_str}': {e}")))?;
            tokens.push(Token::Number(val));
            continue;
        }

        if ch.is_ascii_alphabetic() || ch == '_' {
            let mut ident = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_ascii_alphanumeric() || c == '_' {
                    ident.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            tokens.push(Token::Ident(ident));
            continue;
        }

        match ch {
            '+' => {
                tokens.push(Token::Plus);
                chars.next();
            }
            '-' => {
                tokens.push(Token::Minus);
                chars.next();
            }
            '*' => {
                tokens.push(Token::Star);
                chars.next();
            }
            '/' => {
                tokens.push(Token::Slash);
                chars.next();
            }
            '%' => {
                tokens.push(Token::Percent);
                chars.next();
            }
            '?' => {
                tokens.push(Token::Question);
                chars.next();
            }
            ':' => {
                tokens.push(Token::Colon);
                chars.next();
            }
            '(' => {
                tokens.push(Token::LParen);
                chars.next();
            }
            ')' => {
                tokens.push(Token::RParen);
                chars.next();
            }
            ',' => {
                tokens.push(Token::Comma);
                chars.next();
            }
            '=' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Eq);
                } else {
                    return Err(ExprError::Parse(
                        "Single '=' not supported, use '=='".into(),
                    ));
                }
            }
            '!' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Ne);
                } else {
                    return Err(ExprError::Parse("'!' without '=' is not supported".into()));
                }
            }
            '<' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Le);
                } else {
                    tokens.push(Token::Lt);
                }
            }
            '>' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Ge);
                } else {
                    tokens.push(Token::Gt);
                }
            }
            _ => {
                return Err(ExprError::Parse(format!("Unexpected character '{ch}'")));
            }
        }
    }

    Ok(tokens)
}

// === Parser ===

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(tokens: &'a [Token]) -> Self {
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn advance(&mut self) -> Option<&Token> {
        let tok = self.tokens.get(self.pos);
        self.pos += 1;
        tok
    }

    fn expect(&mut self, expected: &Token) -> Result<(), ExprError> {
        match self.advance() {
            Some(tok) if tok == expected => Ok(()),
            Some(tok) => Err(ExprError::Parse(format!(
                "Expected '{}', got '{}'",
                expected.display(),
                tok.display()
            ))),
            None => Err(ExprError::Parse(format!(
                "Expected '{}', got end of input",
                expected.display()
            ))),
        }
    }

    fn parse_expr(&mut self, depth: u32) -> Result<Expr, ExprError> {
        if depth > MAX_EXPR_DEPTH {
            return Err(ExprError::Parse("expression too deeply nested".into()));
        }
        self.parse_ternary(depth)
    }

    fn parse_ternary(&mut self, depth: u32) -> Result<Expr, ExprError> {
        let cond = self.parse_comparison(depth)?;
        if self.peek() == Some(&Token::Question) {
            self.advance();
            let then_expr = self.parse_expr(depth + 1)?;
            self.expect(&Token::Colon)?;
            let else_expr = self.parse_expr(depth + 1)?;
            Ok(Expr::Ternary {
                cond: Box::new(cond),
                then_expr: Box::new(then_expr),
                else_expr: Box::new(else_expr),
            })
        } else {
            Ok(cond)
        }
    }

    fn parse_comparison(&mut self, depth: u32) -> Result<Expr, ExprError> {
        let left = self.parse_additive(depth)?;
        let cmp_tokens = [
            Token::Eq,
            Token::Ne,
            Token::Lt,
            Token::Gt,
            Token::Le,
            Token::Ge,
        ];
        if let Some(tok) = self.peek()
            && cmp_tokens.contains(tok)
        {
            let op = match self.advance().unwrap() {
                Token::Eq => BinOp::Eq,
                Token::Ne => BinOp::Ne,
                Token::Lt => BinOp::Lt,
                Token::Gt => BinOp::Gt,
                Token::Le => BinOp::Le,
                Token::Ge => BinOp::Ge,
                _ => unreachable!(),
            };
            let right = self.parse_additive(depth)?;
            return Ok(Expr::BinOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
            });
        }
        Ok(left)
    }

    fn parse_additive(&mut self, depth: u32) -> Result<Expr, ExprError> {
        let mut left = self.parse_multiplicative(depth)?;
        while let Some(Token::Plus) | Some(Token::Minus) = self.peek() {
            let op = match self.advance().unwrap() {
                Token::Plus => BinOp::Add,
                Token::Minus => BinOp::Sub,
                _ => unreachable!(),
            };
            let right = self.parse_multiplicative(depth)?;
            left = Expr::BinOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self, depth: u32) -> Result<Expr, ExprError> {
        let mut left = self.parse_unary(depth)?;
        while let Some(Token::Star) | Some(Token::Slash) | Some(Token::Percent) = self.peek() {
            let op = match self.advance().unwrap() {
                Token::Star => BinOp::Mul,
                Token::Slash => BinOp::Div,
                Token::Percent => BinOp::Mod,
                _ => unreachable!(),
            };
            let right = self.parse_unary(depth)?;
            left = Expr::BinOp {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    fn parse_unary(&mut self, depth: u32) -> Result<Expr, ExprError> {
        if depth > MAX_EXPR_DEPTH {
            return Err(ExprError::Parse("expression too deeply nested".into()));
        }
        if self.peek() == Some(&Token::Minus) {
            self.advance();
            let inner = self.parse_unary(depth + 1)?;
            Ok(Expr::UnaryNeg(Box::new(inner)))
        } else {
            self.parse_primary(depth)
        }
    }

    fn parse_primary(&mut self, depth: u32) -> Result<Expr, ExprError> {
        match self.peek() {
            Some(Token::Number(_)) => {
                let val = match self.advance().unwrap() {
                    Token::Number(v) => v,
                    _ => unreachable!(),
                };
                Ok(Expr::Literal(*val))
            }
            Some(Token::Ident(_)) => {
                let name = match self.advance().unwrap() {
                    Token::Ident(s) => s.clone(),
                    _ => unreachable!(),
                };
                if self.peek() == Some(&Token::LParen) {
                    let func = match name.as_str() {
                        "abs" => Func::Abs,
                        "sin" => Func::Sin,
                        "cos" => Func::Cos,
                        "random" => Func::Random,
                        "min" => Func::Min,
                        "max" => Func::Max,
                        "pow" => Func::Pow,
                        _ => {
                            return Err(ExprError::Parse(format!("Unknown function '{name}'")));
                        }
                    };
                    self.advance();
                    let mut args = Vec::new();
                    if self.peek() != Some(&Token::RParen) {
                        args.push(self.parse_expr(depth + 1)?);
                        while self.peek() == Some(&Token::Comma) {
                            self.advance();
                            args.push(self.parse_expr(depth + 1)?);
                        }
                    }
                    self.expect(&Token::RParen)?;
                    Ok(Expr::Call { func, args })
                } else {
                    let var = match name.as_str() {
                        "i" => Var::I,
                        "j" => Var::J,
                        "n" => Var::N,
                        _ => {
                            return Err(ExprError::Parse(format!("Unknown variable '{name}'")));
                        }
                    };
                    Ok(Expr::Var(var))
                }
            }
            Some(Token::LParen) => {
                self.advance();
                let expr = self.parse_expr(depth + 1)?;
                self.expect(&Token::RParen)?;
                Ok(expr)
            }
            Some(tok) => Err(ExprError::Parse(format!(
                "Unexpected token '{}'",
                tok.display()
            ))),
            None => Err(ExprError::Parse("Unexpected end of input".into())),
        }
    }
}
