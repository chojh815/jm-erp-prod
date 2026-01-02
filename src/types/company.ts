export type CompanyType = "our_company" | "buyer" | "factory" | "supplier";
export type ShippingOriginCode = "KR_SEOUL" | "CN_QINGDAO" | "CN_JIAOZHOU" | "VN_BACNINH";

export interface CompanySiteDTO {
  id?: string;
  siteName: string;
  originCode?: ShippingOriginCode | string;
  country?: string;
  city?: string;
  address1?: string;
  address2?: string;
  phone?: string;
  taxId?: string;
  bankName?: string;
  bankAccount?: string;
  accountHolderName?: string;
  swift?: string;
  currency?: string;
  exporterOfRecord?: boolean;
  originCountry?: string;
  isDefault?: boolean;
}

export interface CompanyDTO {
  id?: string;
  companyType: CompanyType;
  companyName: string;
  code?: string;
  country?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  taxId?: string;
  bankName?: string;
  bankAccount?: string;
  accountHolderName?: string;
  swift?: string;
  currency?: string;
  buyerPaymentTerm?: string;
  buyerDefaultIncoterm?: string;
  buyerDefaultShipMode?: string;
  apContactName?: string;
  apEmail?: string;
  apPhone?: string;
  originMark?: string;
  factoryAirPort?: string;
  factorySeaPort?: string;
  memo?: string;
  isActive: boolean;
  preferredOrigins?: ShippingOriginCode[];
  sites?: CompanySiteDTO[]; // our_company일 때만 들어옴
}
