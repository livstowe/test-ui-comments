describe('Changing a sample item state', () => {
  it('enables and disables the same item', () => {
    cy.visit('/');
    cy.get('[data-item-id="notes"] .state').should('be.visible').and('have.text', 'Disabled');
    cy.wait(1000);
    cy.get('[data-item-id="notes"] button').should('have.text', 'Enable').click();
    cy.get('[data-item-id="notes"] .state').should('be.visible').and('have.text', 'Enabled');
    cy.get('[data-item-id="notes"] button').should('have.text', 'Disable');
    cy.wait(1400);
    cy.screenshot('toggle-state-enabled', { capture: 'viewport' });
    cy.get('[data-item-id="notes"] button').click();
    cy.get('[data-item-id="notes"] .state').should('be.visible').and('have.text', 'Disabled');
    cy.get('[data-item-id="notes"] button').should('have.text', 'Enable');
    cy.wait(1400);
  });
});
