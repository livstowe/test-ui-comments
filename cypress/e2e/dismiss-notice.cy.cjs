describe('Making space in the sample board', () => {
  it('dismisses and restores the sample notice', () => {
    cy.visit('/');
    cy.get('[data-testid="notice"]').should('be.visible').and('contain.text', 'Everything here is a sample.');
    cy.wait(1000);
    cy.get('#dismiss-notice').click();
    cy.get('[data-testid="notice"]').should('not.be.visible');
    cy.get('#restore-notice').should('be.visible').and('be.focused');
    cy.wait(1400);
    cy.get('#restore-notice').click();
    cy.get('[data-testid="notice"]').should('be.visible');
    cy.get('#dismiss-notice').should('be.focused');
    cy.wait(1400);
    cy.screenshot('dismiss-notice-restored', { capture: 'viewport' });
  });
});
