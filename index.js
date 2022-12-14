const fs = require('fs');
const nconf = require('nconf');
const { getBearerToken } = require('./lib/clients/iam-client');
const { getServices } = require('./lib/clients/toolchain-client');

nconf.env('__');
if (process.env.NODE_ENV === 'local') {
    nconf.file('local', './config/local.json');
}
nconf.file('defaults', './config/defaults.json');

const ALLOWED_PARAMETER_TYPES = new Set(nconf.get('ALLOWED_PARAMETER_TYPES'));
const EXCLUDE_SERVICES = new Set(nconf.get('EXCLUDE_SERVICES'));
const IMMUTABLE_SERVICE_PARAMETERS = nconf.get('IMMUTABLE_SERVICE_PARAMETERS');
const MAP_SERVICE_PARAMETERS_TO_TERRAFORM = nconf.get('MAP_SERVICE_PARAMETERS_TO_TERRAFORM');
const SECTION_TITLES = nconf.get('SECTION_TITLES');
const SERVICE_MARKDOWN_DISPLAYNAMES = nconf.get('SERVICE_MARKDOWN_DISPLAYNAMES');
const SERVICE_PARAMETER_DESCRIPTIONS = nconf.get('SERVICE_PARAMETER_DESCRIPTIONS');

for (const broker in IMMUTABLE_SERVICE_PARAMETERS) {
    IMMUTABLE_SERVICE_PARAMETERS[broker] = new Set(IMMUTABLE_SERVICE_PARAMETERS[broker]);
}

const main = async () => {
    const md = [];
    try {
        console.log('Generating markdown for tool brokers ...');
        const token = await getBearerToken();
        const services = await getServices(token);
        const resources = Object.values(services.resources);

        resources.forEach((resource) => {
            const brokerId = resource.entity.unique_id;
            const brokerProperties = resource.metadata?.parameters?.properties || {};
            const displayName = SERVICE_MARKDOWN_DISPLAYNAMES[brokerId] || resource.metadata.displayName;
            const requiredParams = new Set(resource.metadata?.parameters?.required || []);
            const sectionTitle = SECTION_TITLES[brokerId] || `Configuring ${displayName} by using the API`
            if (EXCLUDE_SERVICES.has(brokerId)) {
                console.warn(`Skipping broker: ${brokerId}`);
                return;
            };
            if (Object.keys(brokerProperties).length === 0) {
                console.warn(`Skipping broker '${brokerId}' because it has no parameters!`);
                return;
            };
            console.log(`Processing broker: ${brokerId}`);
            md.push(`\n## ${sectionTitle}`);
            md.push('{: #config-parameters}\n');
            md.push(`The ${displayName} tool integration supports the following configuration parameters that you can use with the [Toolchain HTTP API and SDKs](https://cloud.ibm.com/apidocs/toolchain){: external} when you [create](https://cloud.ibm.com/apidocs/toolchain#create-tool){: external}, [read](https://cloud.ibm.com/apidocs/toolchain#get-tool-by-id){: external}, and [update](https://cloud.ibm.com/apidocs/toolchain#update-tool){: external} tool integrations.\n`);
            md.push(`You must specify the \`tool_type_id\` property in the request body with the \`${brokerId}\` value.`);
            md.push(`{: important}\n`);
            md.push('| Parameter | Usage | Type | Terraform argument | Description |');
            md.push('| --- | --- | --- | --- | --- |');
            const sortedBrokerParameters = Object.keys(brokerProperties).sort();
            sortedBrokerParameters.forEach((parameter) => {
                const parameterDetails = brokerProperties[parameter];
                const isRequired = requiredParams.has(parameter)? 'required' : 'optional';
                const isImmutable = IMMUTABLE_SERVICE_PARAMETERS[brokerId]?.has(parameter)? 'immutable' : 'updatable';
                const defaultValue = parameterDetails.hasOwnProperty('default')? `, \`Default: ${parameterDetails.default}\`` : '';
                const terraformArgument = parameterDetails.terraform_alias || MAP_SERVICE_PARAMETERS_TO_TERRAFORM[brokerId]?.[parameter] || parameter;
                const description = parameterDetails.api_description || SERVICE_PARAMETER_DESCRIPTIONS[brokerId]?.[parameter] || parameterDetails.description || '-';

                if (!ALLOWED_PARAMETER_TYPES.has(parameterDetails.type)) {
                    console.warn(`Parameter '${parameter}' in '${brokerId}' broker will not be included in markdown since it has a type '${parameterDetails.type}'`);
                    return;
                };
                if (parameterDetails['x-terraform-exclude']) {
                    console.warn(`Parameter '${parameter}' in '${brokerId}' broker will not be included in markdown since it is excluded in Terraform`);
                    return;
                };
                let tableRow = '';
                tableRow += `| ${parameter} |`;
                tableRow += ` ${isRequired}, ${isImmutable}${defaultValue} |`;
                tableRow += ` ${capitalizeFirstLetter(parameterDetails.type)} |`;
                tableRow += ` ${terraformArgument} |`;
                tableRow += ` ${replaceDisplayNamesWithMarkdown(description, brokerId, resource.metadata.displayName)} |`;
                md.push(tableRow);
            });
            md.push(`{: caption="Table 1. ${displayName} tool integration parameters" caption-side="bottom"}`);
        });
        var file = fs.createWriteStream('./tool_brokers.md');
        file.on('error', (err) => { throw err });
        md.forEach((v) => file.write(v + '\n'));
        file.end();
    } catch (err) {
        console.error(err.message);
        process.exit(1)
    }
}

const capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const replaceDisplayNamesWithMarkdown = (text, brokerId, displayName) => {
    if (!SERVICE_MARKDOWN_DISPLAYNAMES[brokerId]) {
        return text;
    }
    const regex = new RegExp(`\\b(${displayName})\\b`, 'g');
    return text.replace(regex ,SERVICE_MARKDOWN_DISPLAYNAMES[brokerId]);
}

main();