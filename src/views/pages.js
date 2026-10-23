'use strict';
// Static policy/help page content. `s` = store settings.
module.exports = (s) => ({
  shipping: {
    title: 'Shipping',
    description: 'Free shipping on every order to all 50 US states.',
    sections: [
      [null, [`Every order ships free to any address in the United States (all 50 states). We currently do not ship outside the US.`]],
      ['Processing and delivery times', [
        'Orders are processed within 1–3 business days. Once your order ships, most parcels arrive in 7–14 business days. During the holiday peak, carriers can add a few extra days.',
        `For the best chance of delivery before Christmas, place your order by ${s.christmas_cutoff}.`,
        'Items in the same order may arrive in separate packages from different warehouses.',
      ]],
      ['Tracking', ['As soon as your order ships we add the tracking number to your order page. You can check it any time on our Track Your Order page with your order number and email.']],
      ['Address problems', ['Please double-check your shipping address at checkout. If you notice a mistake, contact us right away — we can update the address as long as the order has not shipped yet.']],
    ],
  },
  returns: {
    title: 'Returns & refunds',
    description: '30-day returns, and we make it right if anything arrives damaged.',
    sections: [
      ['30-day returns', ['If you are not happy with your purchase, you can request a return within 30 days of delivery. Items must be unused and in their original condition. To start a return, contact us with your order number.']],
      ['Damaged, defective or wrong items', ['If anything arrives damaged, defective or different from what you ordered, contact us within 14 days of delivery with your order number and a photo. We will send a free replacement or a full refund — you will not need to send the item back.']],
      ['Lost parcels', ['If your tracking has not updated for 15 business days, or your order has not arrived within 30 days of shipping, contact us and we will reship it or refund you in full.']],
      ['Refunds', ['Approved refunds are issued to your original payment method. Depending on your bank, it can take 5–10 business days to appear on your statement.']],
      ['Cancellations', ['You can cancel any order that has not shipped yet for a full refund — just contact us as soon as possible.']],
    ],
  },
  privacy: {
    title: 'Privacy policy',
    description: 'How we collect, use and protect your information.',
    sections: [
      [null, [`This policy explains what information ${s.store_name} collects when you visit our site or place an order, and how we use it.`]],
      ['Information we collect', [
        'When you place an order we collect your name, email address, phone number and shipping address so that we can fulfil and deliver your order and contact you about it.',
        'Payments are processed by Stripe. Your card details are entered on Stripe’s secure checkout page and are never sent to or stored on our servers.',
        'When you contact us or join our mailing list we store the details you give us.',
        'We keep basic, anonymous visit statistics (pages viewed, referring site, device type). These use a daily-rotating anonymous identifier and do not use cookies.',
      ]],
      ['How we use it', ['We use your information only to process and deliver orders, provide customer support, prevent fraud and, if you opted in, send you occasional offers. We do not sell your personal information.']],
      ['Sharing', ['We share order details only with the service providers needed to run the store: our payment processor (Stripe), our hosting provider, and the suppliers and carriers who fulfil and deliver your order. If we use advertising platforms such as Meta, they may receive limited, standard event data (for example that a page was viewed).']],
      ['Cookies', ['Our storefront uses your browser’s local storage only to remember your shopping cart. Stripe sets its own cookies on its checkout page for fraud prevention.']],
      ['Your rights', ['You can ask us to access, correct or delete your personal information at any time by contacting us. California residents have the right to know what personal information we collect and to request deletion; we do not sell personal information.']],
      ['Data security', ['Our site is served only over HTTPS and access to order data is restricted to authorised staff using strong authentication.']],
      ['Changes', ['We may update this policy from time to time. The latest version will always be on this page.']],
    ],
  },
  terms: {
    title: 'Terms of service',
    description: 'The terms that apply when you use our store.',
    sections: [
      [null, [`By using this website and placing an order with ${s.store_name}, you agree to these terms.`]],
      ['Orders and pricing', ['All prices are in US dollars. We reserve the right to refuse or cancel an order — for example if an item is out of stock or a pricing error occurs — in which case you will receive a full refund.']],
      ['Products', ['We do our best to show products accurately. Colours may vary slightly between screens, and sizes and measurements are approximate. Please check size charts before ordering apparel.']],
      ['Shipping and delivery', ['Delivery times are estimates and are not guaranteed. Risk of loss passes to you on delivery. See our Shipping page for details.']],
      ['Returns', ['Returns and refunds are handled according to our Returns & Refunds policy.']],
      ['Electrical products', ['Use lighting and electrical products only as described, indoors unless stated otherwise, and keep small parts away from young children.']],
      ['Limitation of liability', ['To the extent permitted by law, our liability for any claim relating to a product is limited to the amount you paid for that product.']],
      ['Contact', ['Questions about these terms? Reach us through our Contact page.']],
    ],
  },
  faq: {
    title: 'Frequently asked questions',
    description: 'Answers to common questions about orders, shipping and returns.',
    sections: [
      ['How much is shipping?', ['Shipping is free on every order to the US, with no minimum.']],
      ['How long will my order take?', [`Orders are processed in 1–3 business days and usually arrive in 7–14 business days. Order by ${s.christmas_cutoff} for the best chance of delivery before Christmas.`]],
      ['Do you ship internationally?', ['Not at the moment — we only ship within the United States.']],
      ['How do I track my order?', ['Use the Track Your Order page with your order number and email, or open the link on your order confirmation page.']],
      ['Which payment methods do you accept?', ['All major credit and debit cards, plus Apple Pay and Google Pay where available. Checkout is handled securely by Stripe.']],
      ['Do the lights come with a US plug?', ['Yes — plug-in lights are sent with a US plug. Many of our lights are USB or battery powered; each product page lists its power source.']],
      ['What if my item arrives damaged?', ['Contact us within 14 days with your order number and a photo and we will replace it or refund you — no need to return it.']],
      ['Can I change or cancel my order?', ['Yes, as long as it has not shipped yet. Contact us as soon as possible.']],
    ],
  },
});
