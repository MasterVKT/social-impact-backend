/**
 * Types External Services - Social Finance Impact Platform
 * Interfaces pour les services externes (Stripe, Sumsub, SendGrid)
 */

/**
 * Stripe Types
 */
export namespace StripeTypes {
  
  export interface PaymentIntentCreateParams {
    amount: number;
    currency: string;
    customer?: string;
    payment_method_types: string[];
    metadata: {
      projectId: string;
      contributorUid: string;
      contributionId: string;
      platform: string;
    };
    description: string;
    receipt_email?: string;
    setup_future_usage?: 'on_session' | 'off_session';
  }

  export interface PaymentIntent {
    id: string;
    object: 'payment_intent';
    amount: number;
    amount_capturable: number;
    amount_details: {
      tip: Record<string, any>;
    };
    amount_received: number;
    application: string | null;
    application_fee_amount: number | null;
    automatic_payment_methods: {
      enabled: boolean;
    } | null;
    canceled_at: number | null;
    cancellation_reason: string | null;
    capture_method: 'automatic' | 'manual';
    charges: {
      object: 'list';
      data: Charge[];
      has_more: boolean;
      total_count: number;
      url: string;
    };
    client_secret: string;
    confirmation_method: 'automatic' | 'manual';
    created: number;
    currency: string;
    customer: string | Customer | null;
    description: string | null;
    invoice: string | null;
    last_payment_error: PaymentError | null;
    latest_charge: string | Charge | null;
    livemode: boolean;
    metadata: Record<string, string>;
    next_action: NextAction | null;
    on_behalf_of: string | null;
    payment_method: string | PaymentMethod | null;
    payment_method_options: PaymentMethodOptions;
    payment_method_types: string[];
    processing: Processing | null;
    receipt_email: string | null;
    review: string | null;
    setup_future_usage: 'on_session' | 'off_session' | null;
    shipping: Shipping | null;
    statement_descriptor: string | null;
    statement_descriptor_suffix: string | null;
    status: PaymentIntentStatus;
    transfer_data: TransferData | null;
    transfer_group: string | null;
  }

  export type PaymentIntentStatus = 
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'requires_capture'
    | 'canceled'
    | 'succeeded';

  export interface Charge {
    id: string;
    object: 'charge';
    amount: number;
    amount_captured: number;
    amount_refunded: number;
    application: string | null;
    application_fee: string | null;
    application_fee_amount: number | null;
    balance_transaction: string | null;
    billing_details: BillingDetails;
    calculated_statement_descriptor: string | null;
    captured: boolean;
    created: number;
    currency: string;
    customer: string | Customer | null;
    description: string | null;
    destination: string | null;
    dispute: string | null;
    disputed: boolean;
    failure_code: string | null;
    failure_message: string | null;
    fraud_details: Record<string, any>;
    invoice: string | null;
    livemode: boolean;
    metadata: Record<string, string>;
    on_behalf_of: string | null;
    order: string | null;
    outcome: ChargeOutcome | null;
    paid: boolean;
    payment_intent: string | PaymentIntent | null;
    payment_method: string | null;
    payment_method_details: PaymentMethodDetails | null;
    receipt_email: string | null;
    receipt_number: string | null;
    receipt_url: string | null;
    refunded: boolean;
    refunds: {
      object: 'list';
      data: Refund[];
      has_more: boolean;
      total_count: number;
      url: string;
    };
    review: string | null;
    shipping: Shipping | null;
    source: Source | null;
    source_transfer: string | null;
    statement_descriptor: string | null;
    statement_descriptor_suffix: string | null;
    status: ChargeStatus;
    transfer_data: TransferData | null;
    transfer_group: string | null;
  }

  export type ChargeStatus = 'succeeded' | 'pending' | 'failed';

  export interface Customer {
    id: string;
    object: 'customer';
    address: Address | null;
    balance: number;
    created: number;
    currency: string | null;
    default_source: string | null;
    delinquent: boolean;
    description: string | null;
    discount: Discount | null;
    email: string | null;
    invoice_prefix: string | null;
    invoice_settings: {
      custom_fields: CustomField[] | null;
      default_payment_method: string | null;
      footer: string | null;
      rendering_options: RenderingOptions | null;
    };
    livemode: boolean;
    metadata: Record<string, string>;
    name: string | null;
    next_invoice_sequence: number;
    phone: string | null;
    preferred_locales: string[];
    shipping: Shipping | null;
    tax_exempt: 'none' | 'exempt' | 'reverse';
    test_clock: string | null;
  }

  export interface PaymentMethod {
    id: string;
    object: 'payment_method';
    billing_details: BillingDetails;
    card: Card | null;
    created: number;
    customer: string | Customer | null;
    livemode: boolean;
    metadata: Record<string, string>;
    type: PaymentMethodType;
  }

  export type PaymentMethodType = 'card' | 'sepa_debit' | 'ideal' | 'bancontact' | 'giropay' | 'sofort' | 'p24' | 'eps' | 'fpx';

  export interface Card {
    brand: CardBrand;
    checks: {
      address_line1_check: string | null;
      address_postal_code_check: string | null;
      cvc_check: string | null;
    };
    country: string;
    exp_month: number;
    exp_year: number;
    fingerprint: string;
    funding: 'credit' | 'debit' | 'prepaid' | 'unknown';
    generated_from: GeneratedFrom | null;
    last4: string;
    networks: {
      available: string[];
      preferred: string | null;
    } | null;
    three_d_secure_usage: {
      supported: boolean;
    } | null;
    wallet: Wallet | null;
  }

  export type CardBrand = 'amex' | 'diners' | 'discover' | 'jcb' | 'mastercard' | 'unionpay' | 'visa' | 'unknown';

  export interface Refund {
    id: string;
    object: 'refund';
    amount: number;
    charge: string | Charge;
    created: number;
    currency: string;
    metadata: Record<string, string>;
    payment_intent: string | PaymentIntent | null;
    reason: RefundReason | null;
    receipt_number: string | null;
    source_transfer_reversal: string | null;
    status: RefundStatus | null;
    transfer_reversal: string | null;
  }

  export type RefundReason = 'duplicate' | 'fraudulent' | 'requested_by_customer';
  export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'canceled';

  // Webhook Event Types
  export interface WebhookEvent {
    id: string;
    object: 'event';
    api_version: string;
    created: number;
    data: {
      object: any;
      previous_attributes?: any;
    };
    livemode: boolean;
    pending_webhooks: number;
    request: {
      id: string | null;
      idempotency_key: string | null;
    } | null;
    type: WebhookEventType;
  }

  export type WebhookEventType = 
    | 'payment_intent.succeeded'
    | 'payment_intent.payment_failed'
    | 'payment_intent.canceled'
    | 'payment_intent.requires_action'
    | 'charge.succeeded'
    | 'charge.failed'
    | 'charge.refunded'
    | 'charge.dispute.created'
    | 'invoice.payment_succeeded'
    | 'invoice.payment_failed'
    | 'customer.created'
    | 'customer.updated'
    | 'customer.deleted';

  // Helper interfaces
  export interface Address {
    city: string | null;
    country: string | null;
    line1: string | null;
    line2: string | null;
    postal_code: string | null;
    state: string | null;
  }

  export interface BillingDetails {
    address: Address | null;
    email: string | null;
    name: string | null;
    phone: string | null;
  }

  export interface ChargeOutcome {
    network_status: string | null;
    reason: string | null;
    risk_level: 'normal' | 'elevated' | 'highest' | null;
    risk_score: number | null;
    seller_message: string | null;
    type: 'authorized' | 'manual_review' | 'issuer_declined' | 'blocked' | 'invalid';
  }

  export interface PaymentMethodDetails {
    card?: {
      brand: string;
      checks: {
        address_line1_check: string | null;
        address_postal_code_check: string | null;
        cvc_check: string | null;
      };
      country: string;
      exp_month: number;
      exp_year: number;
      fingerprint: string;
      funding: string;
      installments: any | null;
      last4: string;
      network: string;
      three_d_secure: any | null;
      wallet: any | null;
    };
  }

  export interface PaymentError {
    code: string;
    decline_code: string | null;
    doc_url: string | null;
    message: string | null;
    param: string | null;
    payment_method: PaymentMethod | null;
    type: 'api_error' | 'card_error' | 'idempotency_error' | 'invalid_request_error';
  }

  export interface NextAction {
    type: string;
    use_stripe_sdk?: any;
    redirect_to_url?: {
      return_url: string;
      url: string;
    };
  }

  export interface PaymentMethodOptions {
    [key: string]: any;
  }

  export interface Processing {
    [key: string]: any;
  }

  export interface Shipping {
    address: Address;
    carrier: string | null;
    name: string;
    phone: string | null;
    tracking_number: string | null;
  }

  export interface TransferData {
    amount: number | null;
    destination: string;
  }

  export interface Source {
    [key: string]: any;
  }

  export interface Discount {
    [key: string]: any;
  }

  export interface CustomField {
    name: string;
    value: string;
  }

  export interface RenderingOptions {
    amount_tax_display: string | null;
  }

  export interface GeneratedFrom {
    [key: string]: any;
  }

  export interface Wallet {
    [key: string]: any;
  }
}

/**
 * Sumsub Types
 */
export namespace SumsubTypes {
  
  export interface AccessToken {
    token: string;
    userId: string;
    ttlInSecs: number;
  }

  export interface CreateApplicantRequest {
    externalUserId: string;
    levelName: string;
    lang?: string;
    email?: string;
    phone?: string;
    country?: string;
    firstName?: string;
    lastName?: string;
    dob?: string; // YYYY-MM-DD
    placeOfBirth?: string;
  }

  export interface Applicant {
    id: string;
    createdAt: string;
    clientId: string;
    inspectionId: string;
    externalUserId: string;
    info: {
      firstName: string;
      lastName: string;
      dob: string;
      country: string;
      nationality?: string;
      phone?: string;
      addresses?: Address[];
    };
    email: string;
    lang: string;
    type: 'individual' | 'company';
  }

  export interface Address {
    country: string;
    postCode: string;
    town: string;
    street: string;
    state?: string;
    buildingName?: string;
    flatNumber?: string;
    buildingNumber?: string;
    startDate?: string;
    endDate?: string;
  }

  export interface Document {
    idDocType: DocumentType;
    country: string;
    fileName?: string;
    content?: string; // base64
  }

  export type DocumentType = 
    | 'PASSPORT'
    | 'ID_CARD'
    | 'DRIVERS'
    | 'UTILITY_BILL'
    | 'BANK_STATEMENT'
    | 'SELFIE'
    | 'VIDEO_SELFIE';

  export interface WebhookData {
    applicantId: string;
    inspectionId: string;
    correlationId: string;
    levelName: string;
    externalUserId: string;
    type: WebhookType;
    reviewStatus: ReviewStatus;
    reviewResult?: {
      reviewAnswer: ReviewAnswer;
      rejectLabels?: string[];
      reviewRejectType?: ReviewRejectType;
      moderationComment?: string;
      clientComment?: string;
      reviewDate?: string;
    };
    applicantType: 'individual' | 'company';
    sandboxMode: boolean;
  }

  export type WebhookType = 
    | 'applicantReviewed'
    | 'applicantPending'
    | 'applicantCreated'
    | 'applicantOnHold'
    | 'applicantActionPending'
    | 'applicantLevelChanged';

  export type ReviewStatus = 
    | 'init'
    | 'pending'
    | 'queued'
    | 'completed'
    | 'onHold';

  export type ReviewAnswer = 
    | 'GREEN'
    | 'RED'
    | 'YELLOW';

  export type ReviewRejectType = 
    | 'FINAL'
    | 'RETRY'
    | 'EXTERNAL';

  export interface GetApplicantStatusResponse {
    id: string;
    clientId: string;
    inspectionId: string;
    externalUserId: string;
    levelName: string;
    createDate: string;
    reviewStatus: ReviewStatus;
    reviewResult?: {
      moderationComment: string;
      clientComment: string;
      reviewAnswer: ReviewAnswer;
      reviewRejectType?: ReviewRejectType;
      rejectLabels?: string[];
      reviewDate: string;
    };
    requiredIdDocs: {
      docSets: {
        idDocSetType: string;
        types: DocumentType[];
      }[];
    };
    info: {
      firstName: string;
      lastName: string;
      dob: string;
      country: string;
      addresses: Address[];
    };
  }

  export interface SumsubError {
    description: string;
    code: number;
    correlationId: string;
  }
}

/**
 * SendGrid Types
 */
export namespace SendGridTypes {
  
  export interface EmailRequest {
    to: string | EmailAddress | EmailAddress[];
    from: EmailAddress;
    subject: string;
    text?: string;
    html?: string;
    templateId?: string;
    dynamicTemplateData?: Record<string, any>;
    personalizations?: Personalization[];
    attachments?: Attachment[];
    categories?: string[];
    customArgs?: Record<string, string>;
    sendAt?: number;
    batchId?: string;
    asm?: {
      groupId: number;
      groupsToDisplay?: number[];
    };
    trackingSettings?: TrackingSettings;
    mailSettings?: MailSettings;
    replyTo?: EmailAddress;
    replyToList?: EmailAddress[];
  }

  export interface EmailAddress {
    email: string;
    name?: string;
  }

  export interface Personalization {
    to: EmailAddress[];
    cc?: EmailAddress[];
    bcc?: EmailAddress[];
    subject?: string;
    headers?: Record<string, string>;
    substitutions?: Record<string, string>;
    dynamicTemplateData?: Record<string, any>;
    customArgs?: Record<string, string>;
    sendAt?: number;
  }

  export interface Attachment {
    content: string; // base64
    filename: string;
    type?: string;
    disposition?: 'inline' | 'attachment';
    contentId?: string;
  }

  export interface TrackingSettings {
    clickTracking?: {
      enable: boolean;
      enableText?: boolean;
    };
    openTracking?: {
      enable: boolean;
      substitutionTag?: string;
    };
    subscriptionTracking?: {
      enable: boolean;
      text?: string;
      html?: string;
      substitutionTag?: string;
    };
    ganalytics?: {
      enable: boolean;
      utmSource?: string;
      utmMedium?: string;
      utmTerm?: string;
      utmContent?: string;
      utmCampaign?: string;
    };
  }

  export interface MailSettings {
    bcc?: {
      enable: boolean;
      email?: string;
    };
    bypassListManagement?: {
      enable: boolean;
    };
    footer?: {
      enable: boolean;
      text?: string;
      html?: string;
    };
    sandboxMode?: {
      enable: boolean;
    };
    spamCheck?: {
      enable: boolean;
      threshold?: number;
      postToUrl?: string;
    };
  }

  export interface SendResponse {
    statusCode: number;
    body: any;
    headers: Record<string, string>;
  }

  export interface WebhookEvent {
    email: string;
    timestamp: number;
    'smtp-id': string;
    event: WebhookEventType;
    category?: string[];
    sg_event_id: string;
    sg_message_id: string;
    useragent?: string;
    ip?: string;
    url?: string;
    urlOffset?: {
      index: number;
      type: string;
    };
    reason?: string;
    status?: string;
    response?: string;
    attempt?: string;
    type?: string;
    tls?: 0 | 1;
    cert_err?: 0 | 1;
    asm_group_id?: number;
  }

  export type WebhookEventType = 
    | 'processed'
    | 'deferred'
    | 'delivered'
    | 'open'
    | 'click'
    | 'bounce'
    | 'dropped'
    | 'spamreport'
    | 'unsubscribe'
    | 'group_unsubscribe'
    | 'group_resubscribe';

  export interface Template {
    id: string;
    name: string;
    generation: 'legacy' | 'dynamic';
    updated_at: string;
    versions: TemplateVersion[];
  }

  export interface TemplateVersion {
    id: string;
    user_id: number;
    template_id: string;
    active: 0 | 1;
    name: string;
    html_content?: string;
    plain_content?: string;
    generate_plain_content: boolean;
    subject: string;
    updated_at: string;
    editor: 'code' | 'design';
    thumbnail_url?: string;
  }

  // Email Templates for the platform
  export interface WelcomeEmailData {
    firstName: string;
    userType: 'contributor' | 'creator';
    kycRequired: boolean;
    profileUrl: string;
  }

  export interface KYCStatusEmailData {
    firstName: string;
    status: 'approved' | 'rejected' | 'requires_action';
    rejectionReason?: string;
    nextSteps?: string;
    supportUrl: string;
  }

  export interface ContributionReceiptEmailData {
    contributorName: string;
    projectTitle: string;
    amount: number;
    currency: string;
    contributionDate: string;
    receiptNumber: string;
    projectUrl: string;
    receiptUrl: string;
  }

  export interface ProjectUpdateEmailData {
    contributorName: string;
    projectTitle: string;
    creatorName: string;
    updateTitle: string;
    updateMessage: string;
    projectUrl: string;
    unsubscribeUrl: string;
  }

  export interface MilestoneCompletedEmailData {
    contributorName: string;
    projectTitle: string;
    milestoneTitle: string;
    completionDate: string;
    impactMetrics: Record<string, any>;
    projectUrl: string;
    certificateUrl?: string;
  }

  export interface AuditAssignmentEmailData {
    auditorName: string;
    projectTitle: string;
    creatorName: string;
    deadline: string;
    compensation: number;
    auditUrl: string;
    projectDetails: {
      category: string;
      fundingGoal: number;
      description: string;
    };
  }
}