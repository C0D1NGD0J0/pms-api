import { createLogger } from '@utils/index';

export interface LeasePreviewData {
  renewalOptions?: {
    autoRenew: boolean;
    renewalTermMonths?: number;
    noticePeriodDays?: number;
  };
  coTenants?: Array<{
    name: string;
    email: string;
    phone: string;
    occupation?: string;
  }>;
  // Additional Provisions
  petPolicy?: {
    allowed: boolean;
    maxPets?: number;
    types?: string;
    deposit?: number;
  };
  legalTerms?: {
    html?: string;
    text?: string;
  };

  requiresNotarization?: boolean;
  landlordSignatureUrl?: string;
  tenantSignatureUrl?: string;
  utilitiesIncluded?: string;

  startDate?: string | Date;
  landlordAddress?: string;
  // Property Information
  propertyAddress?: string;
  securityDeposit?: number;

  endDate?: string | Date;

  landlordEmail?: string;
  landlordPhone?: string;
  // Signature Information
  signingMethod?: string;
  jurisdiction?: string;
  // Landlord Information
  landlordName?: string;
  // Basic Information
  leaseNumber?: string;
  currentDate?: string;

  tenantEmail?: string;
  tenantPhone?: string;
  monthlyRent?: number;
  signedDate?: string;

  // Tenant Information
  tenantName?: string;
  rentDueDay?: number;
  // Lease Terms
  leaseType?: string;
  currency?: string;
}

export class LeaseTemplateDataMapper {
  private readonly log = createLogger('LeaseTemplateDataMapper');

  /**
   * Transform raw preview data into template-compatible format
   */
  public transformForTemplate(previewData: LeasePreviewData): Record<string, any> {
    try {
      const templateData: Record<string, any> = {
        // Basic Information
        leaseNumber: previewData.leaseNumber || 'LEASE-DRAFT',
        currentDate: this.formatDate(previewData.currentDate || new Date().toISOString()),
        jurisdiction: previewData.jurisdiction || 'State/Province',
        signedDate: this.formatDate(previewData.signedDate || new Date().toISOString()),

        // Landlord Information
        landlordName: previewData.landlordName || '[Landlord Name]',
        landlordAddress: previewData.landlordAddress || '[Landlord Address]',
        landlordEmail: previewData.landlordEmail || '[Landlord Email]',
        landlordPhone: previewData.landlordPhone || '[Landlord Phone]',

        // Tenant Information
        tenantName: previewData.tenantName || '[Tenant Name]',
        tenantEmail: previewData.tenantEmail || '[Tenant Email]',
        tenantPhone: previewData.tenantPhone || '[Tenant Phone]',
        coTenants: previewData.coTenants || [],

        // Property Information
        propertyAddress: previewData.propertyAddress || '[Property Address]',

        // Lease Terms
        leaseType: previewData.leaseType || 'Fixed Term Residential Lease',
        startDate: this.formatDate(previewData.startDate),
        endDate: this.formatDate(previewData.endDate),
        monthlyRent: this.formatCurrency(previewData.monthlyRent, previewData.currency),
        securityDeposit: this.formatCurrency(previewData.securityDeposit, previewData.currency),
        rentDueDayOrdinal: this.getOrdinalSuffix(previewData.rentDueDay || 1),

        // Additional Provisions
        petPolicy: this.transformPetPolicy(previewData.petPolicy, previewData.currency),
        renewalOptions: previewData.renewalOptions || null,
        legalTerms: previewData.legalTerms || null,
        utilitiesIncluded: previewData.utilitiesIncluded || null,

        // Signature Information
        signingMethod: previewData.signingMethod || 'manual',
        landlordSignatureUrl: previewData.landlordSignatureUrl || null,
        tenantSignatureUrl: previewData.tenantSignatureUrl || null,
        requiresNotarization: previewData.requiresNotarization || false,
      };

      this.log.info('Successfully transformed lease preview data for template');
      return templateData;
    } catch (error) {
      this.log.error({ error }, 'Failed to transform lease preview data');
      throw new Error(
        `Failed to transform data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Format date to readable string
   */
  private formatDate(date: string | Date | undefined): string {
    if (!date) {
      return new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return '[Invalid Date]';
    }
  }

  /**
   * Format currency amount
   */
  private formatCurrency(amount: number | undefined, currency?: string): string {
    if (amount === undefined || amount === null) {
      return '$0.00';
    }

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
      }).format(amount);
    } catch {
      return `${currency || '$'}${amount.toFixed(2)}`;
    }
  }

  /**
   * Get ordinal suffix for day of month
   */
  private getOrdinalSuffix(day: number): string {
    const j = day % 10;
    const k = day % 100;

    if (j === 1 && k !== 11) {
      return `${day}st`;
    }
    if (j === 2 && k !== 12) {
      return `${day}nd`;
    }
    if (j === 3 && k !== 13) {
      return `${day}rd`;
    }
    return `${day}th`;
  }

  /**
   * Transform pet policy with currency formatting
   */
  private transformPetPolicy(petPolicy: LeasePreviewData['petPolicy'], currency?: string): any {
    if (!petPolicy || !petPolicy.allowed) {
      return null;
    }

    return {
      allowed: true,
      maxPets: petPolicy.maxPets || 1,
      types: petPolicy.types || 'Pets',
      deposit: this.formatCurrency(petPolicy.deposit, currency),
    };
  }
}
