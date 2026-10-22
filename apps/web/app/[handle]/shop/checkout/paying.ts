/**
 * Set by checkout just before it sends the customer to CHIP, read by the order page
 * when they come back: it says "Paid. Order placed" once, rather than only the order.
 * Per tab (sessionStorage), and keyed by the order link's token, which the tab holds.
 */
export const payingKey = (token: string) => `curios-paying:${token}`;
