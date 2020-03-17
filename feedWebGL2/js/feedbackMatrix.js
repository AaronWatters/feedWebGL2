
// jQuery plugin with matrix operations implemented using webGL feedback

(function($) {
    $.fn.feedMatrixContext = function (gl_context) {

        class FeedbackMatrix {

            constructor(mcontext, options) {
                this.settings = $.extend({
                    rows: null,
                    array: null,
                    // dimensions are required if specified using array.
                    num_rows: null,
                    num_cols: null,
                }, options);
                this.context = mcontext;
                var s = this.settings;
                var num_rows = s.num_rows;
                var num_cols = s.num_cols;
                var array = s.array;
                var rows = s.rows;
                if (rows) {
                    // initialize from rows, infer dimensions
                    num_rows = rows.length;
                    num_cols = rows[0].length;
                    if ((!num_rows) || (!num_cols)) {
                        throw new Error("Rows and columns cannot be zero length.");
                    }
                    array = new Float32Array(num_rows * num_cols);
                    var count = 0;
                    for (var i=0; i<num_rows; i++) {
                        var row = rows[i];
                        if (row.length != num_cols) {
                            throw new Error("Rows lengths must be the same.")
                        }
                        for (var j=0; j<num_cols; j++) {
                            array[count] = row[j];
                            count ++;
                        }
                    }
                } else {
                    // initialize from array with explicit dimensions
                    if ((!array) || (!num_rows) || (!num_cols)) {
                        throw new Error("Underspecified matrix.");
                    }
                    if (num_rows * num_cols != array.length) {
                        throw new Error("Specified matrix dimensions do not match array length.");
                    }
                }
                this.num_rows = num_rows;
                this.num_cols = num_cols;
                this.array = array;
            };
            dot(other) {
                // matrix multiply this with other.
                return this.context.dot(this, other);
            }
        };

        var multiplier_shader = `#version 300 es

        // rows are "per mesh"
        in int aRow;
        // columns are "per vertex"
        in int aCol;

        uniform sampler2D RightMatrix;
        uniform sampler2D LeftMatrix;

        // matrix multiplication entry at aRow, aCol
        out float dot_product;

        void main() {
            // foil the optimizer
            gl_Position = vec4(aRow, aCol, aRow, aCol);
            int iCol = gl_VertexID;
            int iRow = gl_InstanceID;
            ivec2 lsize = textureSize(LeftMatrix, 0);
            ivec2 rsize = textureSize(RightMatrix, 0);
            //int N = lsize[0];
            int Klimit = lsize[1];
            // assert Klimit == rsize[0]
            //int M = rsize[1];
            float elt_sum = 0.0;
            for (int k=0; k<Klimit; k++) {
                // data in the red component only.
                float l_value = texelFetch(LeftMatrix, ivec2(iRow, k), 0).r;
                float r_value = texelFetch(RightMatrix, ivec2(k, iCol), 0).r;
                elt_sum += l_value * r_value;
            }
            dot_product = elt_sum;
        }
        `;

        class FeedbackMultiplier {
            constructor(mcontext) {
                this.mcontext = mcontext;
                this.context = mcontext.context;
                this.L = this.context.texture("LeftMatrix", "FLOAT", "RED", "R32F");
                this.R = this.context.texture("RightaMatrix", "FLOAT", "RED", "R32F");
                this.program = this.context.program({
                    vertex_shader: multiplier_shader,
                    feedbacks: {
                        dot_product: {num_components: 1,},
                    },
                });
            };
            multiply(LeftMatrix, RightMatrix) {
                var nk = LeftMatrix.num_cols;
                if (nk != RightMatrix.num_rows) {
                    throw new Error("matrices to not align.");
                }
                var nrows = LeftMatrix.num_rows;
                var ncols = RightMatrix.num_cols;
                var dummy_array = new Float32Array(Math.max(nrows,ncols));
                // should deallocate if exists?
                this.dummyBuffer = this.context.buffer("multiplyDummyBuffer");
                this.dummyBuffer.initialize_from_array(dummy_array);
                this.L.load_array(LeftMatrix.array, LeftMatrix.num_cols, LeftMatrix.num_rows);
                this.R.load_array(RightMatrix.array, RightMatrix.num_cols, RightMatrix.num_rows);
                var runr = this.program.runner({
                    num_instances: nrows,
                    vertices_per_instance: ncols,
                    uniforms: {},
                    rasterize: false,
                    inputs: {
                        aRow: {
                            per_vertex: false,
                            num_components: 1, 
                            type: "int",
                            from_buffer: {
                                name: "multiplyDummyBuffer",
                            },
                        },
                        aCol: {
                            per_vertex: true,
                            num_components: 1,
                            type: "int",
                            from_buffer: {
                                name: "multiplyDummyBuffer",
                            },
                        },
                    },
                    samplers: {
                        "LeftMatrix": {
                            dim: "2D",
                            from_texture: "LeftMatrix",
                        },
                        "RightMatrix": {
                            dim: "2D",
                            from_texture: "RightaMatrix",
                        },
                    },
                });
                runr.run();
                var dotArray = runr.feedback_array("dot_product");
                var result = this.mcontext.matrix({
                    array: dotArray,
                    num_rows: nrows,
                    num_cols: ncols,
                });
                return result;
            };
        }

        class FeedMatrixContext {
            constructor(context) {
                this.context = context;
                this.multiplier = new FeedbackMultiplier(this);
            };
            matrix(options) {
                return new FeedbackMatrix(this, options);
            };
            dot(left, right) {
                return this.multiplier.multiply(left, right);
            }
        };

        return new FeedMatrixContext(gl_context);
    };

    $.fn.feedMatrixContext.multiply_example = function(container) {
        var gl = $.fn.feedWebGL2.setup_gl_for_example(container);
        var gl_context = container.feedWebGL2({gl: gl});
        var mcontext = container.feedMatrixContext(gl_context);
        var M1 = mcontext.matrix({
            rows: [
                [1, 0, 1, 0],
                [0, 1, 0, 1],
                [0, 0, 1, 0],
            ],
        });
        var M2 = mcontext.matrix({
            rows: [
                [1, 0, 1],
                [0, 1, 0],
                [0, 0, 1],
                [1, 1, 1],
            ],
        });
        var dump_matrix = function(M, name) {
            $("<h1>" + name +" matrix</h1>").appendTo(container);
            var t = $("<table border/>").appendTo(container);
            var count = 0;
            for (var i=0; i<M.num_rows; i++) {
                var tr = $("<tr>").appendTo(t);
                for (var j=0; j<M.num_cols; j++) {
                    $("<td>" + M.array[count].toFixed(3) + "</td>").appendTo(tr);
                    count++;
                }
            }
        };
        dump_matrix(M1, "M1");
        dump_matrix(M2, "M2");
        var M1dotM2 = M1.dot(M2);
        dump_matrix(M1dotM2, "M1 dot M2");
    };

})(jQuery)