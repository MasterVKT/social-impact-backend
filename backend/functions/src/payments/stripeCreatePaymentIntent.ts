/**
 * Stripe Create Payment Intent Firebase Function
 * Social Finance Impact Platform
 * 
 * This function creates a Stripe PaymentIntent for processing contributions
 * It's a wrapper/alias for createContribution for compatibility
 */

import {createContribution} from './createContribution';

/**
 * Create Payment Intent (Alias for createContribution)
 * 
 * This function is an alias to maintain compatibility with frontend code
 * that calls 'stripeCreatePaymentIntent'
 */
export const stripeCreatePaymentIntent = createContribution;
