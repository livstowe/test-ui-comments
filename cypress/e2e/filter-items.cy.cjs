describe('Filtering the sample collection', () => {
  it('shows a match, an empty result, and the restored collection', () => {
    cy.visit('/');
    cy.get('#items .item').should('have.length', 3);
    cy.get('#result-count').should('be.visible').and('have.text', '3 items shown');
    // Holds let a reviewer read each state; assertions handle readiness.
    cy.wait(1000);
    cy.get('#item-filter').type('notes', { delay: 100 });
    cy.get('#items .item').should('have.length', 1).and('contain.text', 'Morning notes');
    cy.get('#result-count').should('have.text', '1 item shown');
    cy.wait(1000);
    cy.screenshot('filter-items-single-match', { capture: 'viewport' });
    cy.get('#item-filter').clear().type('nothing matches', { delay: 50 });
    cy.get('#items .item').should('have.length', 0);
    cy.get('#empty-state').should('be.visible');
    cy.wait(1000);
    cy.get('#reset-filter').click();
    cy.get('#item-filter').should('have.value', '');
    cy.get('#items .item').should('have.length', 3);
    cy.get('#empty-state').should('not.be.visible');
    cy.wait(1000);
  });
});
