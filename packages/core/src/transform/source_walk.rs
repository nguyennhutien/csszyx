//! One walker for every scan that reads a whole file.
//!
//! Each type that implements oxc's `Visit` carries its own copy of the walk,
//! about 8 KB gzip of the wasm artifact. The module-link and global-variable
//! scans share this one, each reading through the part it owns; a scan that
//! is not asked for leaves its part out and pays only the check.

use oxc_ast::ast::{
    CallExpression, ImportExpression, JSXAttribute, JSXElement, JSXText, StringLiteral,
    TSImportEqualsDeclaration, TemplateLiteral, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};

use super::global_var_usages::UsageScan;
use super::module_links::LinkScan;

/// The walk, and what each scan collects in it.
#[derive(Default)]
pub struct SourceWalk {
    /// The global-variable scan's part, when it runs.
    pub usages: Option<UsageScan>,
    /// The module-link scan's part, when it runs.
    pub links: Option<LinkScan>,
}

impl<'a> Visit<'a> for SourceWalk {
    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        if let Some(usages) = &mut self.usages {
            usages.declarator(declarator);
        }
        walk::walk_variable_declarator(self, declarator);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(usages) = &mut self.usages {
            usages.style_method(call);
        }
        if let Some(links) = &mut self.links {
            links.call(call);
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        if let Some(usages) = &mut self.usages {
            usages.jsx_attribute(attribute);
        }
        walk::walk_jsx_attribute(self, attribute);
    }

    fn visit_import_expression(&mut self, import: &ImportExpression<'a>) {
        if let Some(links) = &mut self.links {
            links.import_expression(import);
        }
        walk::walk_import_expression(self, import);
    }

    fn visit_ts_import_equals_declaration(&mut self, declaration: &TSImportEqualsDeclaration<'a>) {
        if let Some(links) = &mut self.links {
            links.import_equals(declaration);
        }
    }

    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        let style = self.links.is_some() && LinkScan::is_style(element);
        if let (true, Some(links)) = (style, &mut self.links) {
            links.in_style += 1;
        }
        walk::walk_jsx_element(self, element);
        if let (true, Some(links)) = (style, &mut self.links) {
            links.in_style -= 1;
        }
    }

    fn visit_jsx_text(&mut self, text: &JSXText<'a>) {
        // JSX text holds no `<`, so outside a `<style>` element it is neither
        // CSS nor markup that builds one; `text` files it by where it sits.
        if let Some(links) = &mut self.links {
            links.text(&text.value);
        }
    }

    fn visit_string_literal(&mut self, literal: &StringLiteral<'a>) {
        if let Some(links) = &mut self.links {
            links.text(&literal.value);
        }
    }

    fn visit_template_literal(&mut self, template: &TemplateLiteral<'a>) {
        if let Some(links) = &mut self.links {
            links.template(template);
        }
        walk::walk_template_literal(self, template);
    }
}
