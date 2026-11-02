/*
 *  Copyright (c) 2026, WSO2 LLC. (http://www.wso2.org) All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

package npimaskingregex

// Action decides what replaces a detected value.
type Action string

const (
	// ActionMask replaces the value with a placeholder that is restored in the
	// response, so a value the LLM never saw can still reach the agent's next
	// tool call.
	ActionMask Action = "mask"
	// ActionRedact replaces the value with RedactionMarker. Nothing is stored and
	// nothing is restored.
	ActionRedact Action = "redact"
)

// builtinEntity is one entry of the built-in NPI catalogue.
//
// Keys are written in their natural casing because they serve twice: normalised
// for exact matching against JSON object keys, and split into words to build the
// label regex that finds the same field in prose (accountNumber → "account number").
type builtinEntity struct {
	Name   string
	Keys   []string
	Action Action
	// LabelValue is the regex for the value that follows a label in free text.
	// Empty disables labelled-text detection for the entity.
	LabelValue string
	// LabelNeedsDigit rejects a labelled match whose value has no digit, which is
	// what stops "an account id is required" from masking the word "required".
	LabelNeedsDigit bool
}

// Built-in entity names. Format detectors (detectors.go) reuse the names of the
// key-based entities they correspond to, so a card number found by its shape and
// one found by its key share one placeholder namespace.
const (
	EntityAccountNumber  = "ACCOUNT_NUMBER"
	EntityAccountID      = "ACCOUNT_ID"
	EntityCardNumber     = "CARD_NUMBER"
	EntityCardExpiry     = "CARD_EXPIRY"
	EntityCardCVV        = "CARD_CVV"
	EntityIBAN           = "IBAN"
	EntityCustomerID     = "CUSTOMER_ID"
	EntityNationalID     = "NATIONAL_ID"
	EntityPassportNumber = "PASSPORT_NUMBER"
	EntityDateOfBirth    = "DATE_OF_BIRTH"
	EntityPhone          = "PHONE"
	EntityEmail          = "EMAIL"
	EntityAddress        = "ADDRESS"
)

const (
	idLabelValue   = `[A-Za-z0-9][A-Za-z0-9_-]{2,62}[A-Za-z0-9]`
	cardLabelValue = `\d(?:[ -]?\d){12,18}`
)

// builtinEntities is the default catalogue, in the order labelled-text detectors
// run. Amounts, personal names and bank identifiers (BIC, routing, sort code) are
// deliberately absent; see the design document for why.
var builtinEntities = []builtinEntity{
	{
		Name:            EntityAccountNumber,
		Keys:            []string{"accountNumber", "accountNo", "accountNum", "acctNumber", "acctNo", "bankAccountNumber"},
		Action:          ActionMask,
		LabelValue:      `[A-Z0-9](?:[A-Z0-9 -]{2,32}[A-Z0-9])`,
		LabelNeedsDigit: true,
	},
	{
		Name:            EntityAccountID,
		Keys:            []string{"accountId", "acctId"},
		Action:          ActionMask,
		LabelValue:      idLabelValue,
		LabelNeedsDigit: true,
	},
	{
		Name:            EntityCardNumber,
		Keys:            []string{"cardNumber", "cardNo", "pan", "primaryAccountNumber"},
		Action:          ActionMask,
		LabelValue:      cardLabelValue,
		LabelNeedsDigit: true,
	},
	{
		Name:       EntityCardExpiry,
		Keys:       []string{"expiry", "expiryDate", "expirationDate", "cardExpiry", "expDate", "validThru"},
		Action:     ActionRedact,
		LabelValue: `(?:0[1-9]|1[0-2])[ \t]*/[ \t]*(?:\d{4}|\d{2})`,
	},
	{
		Name:       EntityCardCVV,
		Keys:       []string{"cvv", "cvv2", "cvc", "cvc2", "csc", "securityCode"},
		Action:     ActionRedact,
		LabelValue: `\d{3,4}`,
	},
	{
		Name:   EntityIBAN,
		Keys:   []string{"iban"},
		Action: ActionMask,
		// Found by format anywhere; no separate label shape is needed.
	},
	{
		Name:            EntityCustomerID,
		Keys:            []string{"customerId", "customerNumber", "cif", "cifNumber", "memberId"},
		Action:          ActionMask,
		LabelValue:      idLabelValue,
		LabelNeedsDigit: true,
	},
	{
		Name:            EntityNationalID,
		Keys:            []string{"nationalId", "nic", "ssn", "nin", "taxId", "tin"},
		Action:          ActionMask,
		LabelValue:      `[A-Za-z0-9](?:[A-Za-z0-9 -]{3,18}[A-Za-z0-9])`,
		LabelNeedsDigit: true,
	},
	{
		Name:            EntityPassportNumber,
		Keys:            []string{"passportNumber", "passportNo"},
		Action:          ActionMask,
		LabelValue:      `[A-Z0-9]{6,9}`,
		LabelNeedsDigit: true,
	},
	{
		Name:       EntityDateOfBirth,
		Keys:       []string{"dob", "dateOfBirth", "birthDate"},
		Action:     ActionMask,
		LabelValue: `\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}`,
	},
	{
		Name:            EntityPhone,
		Keys:            []string{"phone", "phoneNumber", "mobile", "mobileNumber", "msisdn"},
		Action:          ActionMask,
		LabelValue:      `\+?\d[\d -]{6,18}\d`,
		LabelNeedsDigit: true,
	},
	{
		Name:   EntityEmail,
		Keys:   []string{"email", "emailAddress"},
		Action: ActionMask,
		// Found by format anywhere.
	},
	{
		Name:   EntityAddress,
		Keys:   []string{"address", "streetAddress", "addressLine1", "addressLine2", "postalCode", "zipCode"},
		Action: ActionMask,
		// Addresses have no bounded shape in prose, so only the key finds them.
	},
}

// findBuiltinEntity returns the built-in entity with the given name.
func findBuiltinEntity(name string) (builtinEntity, bool) {
	for _, e := range builtinEntities {
		if e.Name == name {
			return e, true
		}
	}
	return builtinEntity{}, false
}
