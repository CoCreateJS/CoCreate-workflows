export default {
	organization_id: "",
	key: "",
	host: "",
	sources: [
		{
			array: "files",
			object: {
				name: "index.html",
				path: "/docs/workflows",
				pathname: "/docs/workflows/index.html",
				src: "{{./docs/index.html}}",
				host: ["cocreate.app", "general.cocreate.app"],
				directory: "workflows",
				"content-type": "{{content-type}}",
				public: "true"
			}
		}
	]
};
